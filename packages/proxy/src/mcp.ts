// Transparent MCP stdio framing; only tool calls participate in admission.
import { spawn } from 'node:child_process';
import {
  isJSONRPCRequest,
  isJSONRPCResponse,
  type JSONRPCMessage,
  type JSONRPCRequest,
  serializeMessage,
} from '@modelcontextprotocol/client';
import { getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import type { Outcome } from '@semaphile/core/client';
import { integer } from './index.js';
import { ProxyInputError } from './errors.js';
import { MessageReader, MessageWriter } from './mcp-wire.js';
import type { McpProxy, McpProxyOptions } from './mcp-types.js';
export type { McpProxy, McpProxyOptions } from './mcp-types.js';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
type Job = {
  bytes: number;
  id: string | number;
  tool: boolean;
  started: boolean;
  cancelled: boolean;
  controller: AbortController;
  terminal: ReturnType<typeof deferred<Outcome>>;
  timer?: ReturnType<typeof setTimeout>;
  cancellation?: ReturnType<typeof setTimeout>;
};
function validate(options: McpProxyOptions) {
  if (typeof options.command !== 'string' || !options.command || options.command.includes('\0')) {
    throw new ProxyInputError('MCP requires an executable');
  }
  if (
    options.args !== undefined &&
    (!Array.isArray(options.args) ||
      options.args.length > 256 ||
      options.args.some((value) => typeof value !== 'string' || value.includes('\0')))
  ) {
    throw new ProxyInputError('Invalid MCP argument array');
  }
  if (
    options.cwd !== undefined &&
    (typeof options.cwd !== 'string' || !options.cwd || options.cwd.includes('\0'))
  ) {
    throw new ProxyInputError('Invalid MCP working directory');
  }
  if (options.stderr !== undefined && !['ignore', 'inherit'].includes(options.stderr)) {
    throw new ProxyInputError('Invalid MCP stderr policy');
  }
  if (typeof options.limiter?.startExecution !== 'function') {
    throw new ProxyInputError('MCP requires a compatible limiter');
  }
  const env: Record<string, string> = Object.assign(Object.create(null), getDefaultEnvironment());
  if (
    options.env !== undefined &&
    (!options.env || typeof options.env !== 'object' || Array.isArray(options.env))
  ) {
    throw new ProxyInputError('Invalid MCP environment');
  }
  for (const [name, value] of Object.entries(options.env ?? {})) {
    if (
      !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) ||
      typeof value !== 'string' ||
      value.includes('\0')
    ) {
      throw new ProxyInputError('Invalid MCP environment');
    }
    env[name] = value;
  }
  const weights = new Map<string, number>();
  if (
    options.toolWeights !== undefined &&
    (!options.toolWeights ||
      typeof options.toolWeights !== 'object' ||
      Array.isArray(options.toolWeights))
  ) {
    throw new ProxyInputError('Invalid MCP tool weights');
  }
  for (const [name, weight] of Object.entries(options.toolWeights ?? {})) {
    if (!name || name.length > 256 || weights.size >= 1024) {
      throw new ProxyInputError('Invalid MCP tool weights');
    }
    weights.set(name, integer(weight, 'tool weight'));
  }
  return {
    env,
    weights,
    maxMessageBytes: integer(options.maxMessageBytes ?? 1048576, 'maxMessageBytes', 256, 16777216),
    maxBufferedBytes: integer(
      options.maxBufferedBytes ?? 8388608,
      'maxBufferedBytes',
      256,
      67108864,
    ),
    maxPending: integer(options.maxPending ?? 256, 'maxPending', 1, 10000),
    maxControlPending: integer(options.maxControlPending ?? 64, 'maxControlPending', 1, 1024),
    queueTimeoutMs: integer(options.queueTimeoutMs ?? 30000, 'queueTimeoutMs'),
    requestTimeoutMs: integer(options.requestTimeoutMs ?? 300000, 'requestTimeoutMs'),
    cancellationGraceMs: integer(options.cancellationGraceMs ?? 2000, 'cancellationGraceMs'),
    shutdownGraceMs: integer(options.shutdownGraceMs ?? 2000, 'shutdownGraceMs', 1, 30000),
  };
}
/** Own one child server, borrowing the limiter and downstream streams. */
export async function startMcpProxy(options: McpProxyOptions): Promise<McpProxy> {
  const settings = validate(options);
  const input = options.input ?? process.stdin,
    output = options.output ?? process.stdout;
  if (
    typeof input?.on !== 'function' ||
    typeof input?.removeListener !== 'function' ||
    typeof input?.pause !== 'function' ||
    typeof output?.on !== 'function' ||
    typeof output?.write !== 'function' ||
    typeof output?.removeListener !== 'function'
  ) {
    throw new ProxyInputError('MCP requires readable input and writable output streams');
  }
  if (output.destroyed || output.writableEnded) {
    throw new ProxyInputError('MCP requires an open output stream');
  }
  const downstream = new MessageWriter(output, settings.maxMessageBytes, settings.maxBufferedBytes);
  const child = spawn(options.command, [...(options.args ?? [])], {
    cwd: options.cwd,
    env: settings.env,
    shell: false,
    stdio: ['pipe', 'pipe', options.stderr ?? 'ignore'],
  });
  const upstream = new MessageWriter(
    child.stdin!,
    settings.maxMessageBytes,
    settings.maxBufferedBytes,
  );
  const jobs = new Set<Job>(),
    ids = new Map<string | number, Job>(),
    work = new Set<Promise<void>>();
  const serverRequests = new Map<
    string | number,
    {
      bytes: number;
      timer: ReturnType<typeof setTimeout>;
      done: ReturnType<typeof deferred<void>>;
    }
  >();
  let idle: ReturnType<typeof deferred<void>> | undefined;
  const retainedBytes = () =>
    [...jobs].reduce((n, job) => n + job.bytes, 0) +
    [...serverRequests.values()].reduce((n, request) => n + request.bytes, 0);
  const finishServerRequest = (id: string | number) => {
    const request = serverRequests.get(id);
    if (request) {
      serverRequests.delete(id);
      clearTimeout(request.timer);
      request.done.resolve();
    }
  };
  const done = deferred<void>(),
    exited = deferred<void>();
  let childExited = false,
    stopping = false,
    error: string | undefined;
  let closing: Promise<void> | undefined, terminating: Promise<void> | undefined;
  const forget = (job: Job) => {
    clearTimeout(job.timer);
    clearTimeout(job.cancellation);
    jobs.delete(job);
    if (ids.get(job.id) === job) {
      ids.delete(job.id);
    }
  };
  const removeId = (job: Job) => {
    if (ids.get(job.id) === job) {
      ids.delete(job.id);
    }
  };
  const replyError = (job: Job, code: string) => {
    if (ids.get(job.id) !== job) {
      return;
    }
    removeId(job);
    void downstream
      .send({ jsonrpc: '2.0', id: job.id, error: { code: -32000, message: code } })
      .catch(() => fail('OUTPUT_FAILURE'));
  };
  const terminate = (): Promise<void> =>
    (terminating ??= (async () => {
      if (childExited) {
        return;
      }
      child.kill('SIGTERM');
      const timer = setTimeout(() => {
        if (!childExited) {
          child.kill('SIGKILL');
        }
      }, settings.shutdownGraceMs);
      try {
        await exited.promise;
      } finally {
        clearTimeout(timer);
      }
    })());
  const abortJobs = () => {
    for (const job of jobs) {
      job.controller.abort(new Error('MCP proxy closing'));
    }
  };
  function fail(code: string): void {
    if (childExited && stopping) {
      return;
    }
    error ??= code;
    stopping = true;
    abortJobs();
    void terminate();
    void close();
  }
  const childDone = () => {
    if (childExited) {
      return;
    }
    const unexpected = terminating === undefined;
    childExited = true;
    if (unexpected) {
      error ??= 'UPSTREAM_EXIT';
      stopping = true;
      // A drain is not permission to dispatch queued work after a child crash.
      abortJobs();
      for (const job of jobs) {
        replyError(job, 'MCP_UPSTREAM_CLOSED');
      }
    }
    child.stdin!.destroy();
    child.stdout!.destroy();
    upstream.stop();
    for (const job of jobs) {
      job.terminal.resolve({ kind: 'neutral' });
    }
    for (const id of serverRequests.keys()) {
      finishServerRequest(id);
    }
    exited.resolve();
    if (unexpected) {
      void close();
    }
  };
  child.once('exit', childDone);
  child.once('error', childDone);
  const sendUp = (message: JSONRPCMessage) => {
    void upstream.send(message).catch(() => fail('UPSTREAM_WRITE_FAILED'));
  };
  const sendDown = (message: JSONRPCMessage) => {
    void downstream.send(message).catch(() => fail('OUTPUT_FAILURE'));
  };
  const runTool = async (job: Job, message: JSONRPCRequest) => {
    try {
      const execution = options.limiter.startExecution(
        ({ signal }) => {
          job.started = true;
          const abort = () => {
            replyError(job, stopping ? 'MCP_PROXY_CLOSING' : 'MCP_REQUEST_TIMEOUT');
            if (stopping) {
              void terminate();
            } else {
              fail('REQUEST_ABORTED');
            }
          };
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) {
            abort();
          } else {
            sendUp(message);
          }
          return job.terminal.promise.finally(() => signal.removeEventListener('abort', abort));
        },
        {
          signal: job.controller.signal,
          weight:
            settings.weights.get(
              typeof message.params?.name === 'string' ? message.params.name : '',
            ) ?? 1,
          queueTimeoutMs: settings.queueTimeoutMs,
          retrySafety: 'unsafe',
          policy: {
            classifierId: 'semaphile.mcp/1',
            retry: { maxAttempts: 1 },
            deadlineMs: settings.requestTimeoutMs,
            attemptTimeoutMs: null,
          },
          classifier: {
            id: 'semaphile.mcp/1',
            classify: (result) =>
              result.status === 'fulfilled' && !job.cancelled ? result.value : { kind: 'neutral' },
          },
        },
      );
      try {
        await execution.result;
      } catch (failure) {
        const name = failure instanceof Error ? failure.name : '';
        replyError(
          job,
          job.cancelled
            ? 'MCP_REQUEST_CANCELLED'
            : ['QueueTimeoutError', 'ExecutionTimeoutError'].includes(name)
              ? 'MCP_REQUEST_TIMEOUT'
              : 'MCP_UNAVAILABLE',
        );
      } finally {
        await execution.finished;
      }
    } catch {
      replyError(job, 'MCP_UNAVAILABLE');
    } finally {
      forget(job);
    }
  };
  const track = (promise: Promise<void>) => {
    work.add(promise);
    void promise
      .finally(() => {
        work.delete(promise);
        if (work.size === 0) {
          idle?.resolve();
          idle = undefined;
        }
      })
      .catch(() => fail('INTERNAL_FAILURE'));
  };
  const fromDownstream = (message: JSONRPCMessage) => {
    if (isJSONRPCRequest(message)) {
      if (ids.has(message.id)) {
        fail('DUPLICATE_REQUEST_ID');
        return;
      }
      const tool = message.method === 'tools/call';
      const bytes = Buffer.byteLength(serializeMessage(message));
      const overBytes = retainedBytes() + bytes > settings.maxBufferedBytes;
      const full =
        [...jobs].filter((job) => job.tool === tool).length >=
        (tool ? settings.maxPending : settings.maxControlPending);
      if (stopping || full || overBytes) {
        sendDown({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32000, message: stopping ? 'MCP_PROXY_CLOSING' : 'MCP_QUEUE_FULL' },
        });
        return;
      }
      const job: Job = {
        bytes,
        id: message.id,
        tool,
        started: false,
        cancelled: false,
        controller: new AbortController(),
        terminal: deferred<Outcome>(),
      };
      jobs.add(job);
      ids.set(job.id, job);
      if (tool) {
        track(runTool(job, message));
      } else {
        job.started = true;
        job.timer = setTimeout(() => {
          replyError(job, 'MCP_REQUEST_TIMEOUT');
          fail('CONTROL_TIMEOUT');
        }, settings.requestTimeoutMs);
        track(
          job.terminal.promise.then(() => {
            replyError(job, 'MCP_UPSTREAM_CLOSED');
            forget(job);
          }),
        );
        sendUp(message);
      }
      return;
    }
    if (isJSONRPCResponse(message) && message.id !== undefined) {
      finishServerRequest(message.id);
    }
    if ('method' in message && message.method === 'notifications/cancelled') {
      const id = message.params?.requestId;
      const job = typeof id === 'number' || typeof id === 'string' ? ids.get(id) : undefined;
      if (job) {
        job.cancelled = true;
        if (!job.started) {
          job.controller.abort(new Error('MCP request cancelled'));
          return;
        }
        job.cancellation ??= setTimeout(() => {
          replyError(job, 'MCP_REQUEST_CANCELLED');
          fail('CANCELLATION_TIMEOUT');
        }, settings.cancellationGraceMs);
      }
    }
    // Responses to server requests, notifications and cancellation never wait for a tool lease.
    sendUp(message);
  };
  const fromUpstream = (message: JSONRPCMessage) => {
    if (isJSONRPCRequest(message)) {
      const bytes = Buffer.byteLength(serializeMessage(message));
      if (serverRequests.has(message.id)) {
        fail('DUPLICATE_SERVER_REQUEST_ID');
        return;
      }
      if (
        serverRequests.size >= settings.maxControlPending ||
        retainedBytes() + bytes > settings.maxBufferedBytes
      ) {
        fail('SERVER_REQUEST_LIMIT');
        return;
      }
      const done = deferred<void>();
      serverRequests.set(message.id, {
        bytes,
        done,
        timer: setTimeout(() => fail('SERVER_REQUEST_TIMEOUT'), settings.requestTimeoutMs),
      });
      track(done.promise);
    }
    if (isJSONRPCResponse(message)) {
      const job = message.id === undefined ? undefined : ids.get(message.id);
      if (job) {
        removeId(job);
        clearTimeout(job.cancellation);
        clearTimeout(job.timer);
        job.terminal.resolve({
          kind: 'result' in message && !message.result.isError ? 'success' : 'neutral',
        });
      }
    }
    sendDown(message);
  };
  const incoming = new MessageReader(settings.maxMessageBytes);
  const outgoing = new MessageReader(settings.maxMessageBytes);
  const read =
    (buffer: MessageReader, receive: (message: JSONRPCMessage) => void) =>
    (chunk: Buffer | string) => {
      try {
        buffer.append(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        let message;
        while ((message = buffer.readMessage()) !== null) {
          receive(message);
          if (error) {
            break;
          }
        }
      } catch {
        fail('INVALID_MCP_FRAME');
      }
    };
  const inputData = read(incoming, fromDownstream),
    outputData = read(outgoing, fromUpstream);
  const inputEnd = () => {
    void close();
  };
  const outputClose = () => fail('OUTPUT_CLOSED');
  const inputError = () => fail('INPUT_FAILURE'),
    outputError = () => fail('OUTPUT_FAILURE');
  function close(closeOptions: { drain?: boolean } = {}): Promise<void> {
    if (closing) {
      return closing;
    }
    stopping = true;
    closing = Promise.resolve().then(async () => {
      try {
        if (!closeOptions.drain) {
          abortJobs();
          await terminate();
        }
        // Resolve on quiescence, including callbacks accepted while draining tools.
        if (work.size) {
          await (idle ??= deferred<void>()).promise;
        }
        await terminate();
        await downstream.flush(settings.shutdownGraceMs);
      } finally {
        input.removeListener('data', inputData);
        input.pause();
        input.removeListener('end', inputEnd);
        input.removeListener('close', inputEnd);
        input.removeListener('error', inputError);
        output.removeListener('error', outputError);
        output.removeListener('close', outputClose);
        child.stdout!.removeListener('data', outputData);
        upstream.stop();
        downstream.stop();
        incoming.clear();
        outgoing.clear();
        done.resolve();
      }
    });
    void closing.catch(() => {});
    return closing;
  }
  child.stdin!.on('error', () => fail('UPSTREAM_WRITE_FAILED'));
  child.stdout!.on('error', () => fail('UPSTREAM_READ_FAILED'));
  child.stdout!.on('data', outputData);
  const upstreamEnd = () => {
    if (!childExited && terminating === undefined) {
      fail('UPSTREAM_EOF');
    }
  };
  child.stdout!.once('end', upstreamEnd);
  child.stdout!.once('close', upstreamEnd);
  output.on('error', outputError);
  output.once('close', outputClose);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', () => reject(new ProxyInputError('Unable to start MCP executable')));
    });
  } catch (failure) {
    await close();
    throw failure;
  }
  if (!stopping) {
    input.on('data', inputData);
    input.once('end', inputEnd);
    input.once('close', inputEnd);
    input.on('error', inputError);
    if (input.readableEnded || input.destroyed) {
      void close();
    }
  }
  return {
    pid: child.pid!,
    finished: done.promise,
    close,
    inspect: () => ({
      pending: jobs.size + serverRequests.size,
      active: [...jobs].filter((job) => job.tool && job.started).length,
      closing: stopping,
      ...(error ? { error } : {}),
    }),
  };
}
