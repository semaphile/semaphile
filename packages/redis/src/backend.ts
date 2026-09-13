import type { TelemetryOptions } from '@semaphile/core/client';
// Local FIFO requests share Redis admission state; callbacks stay in the caller.
import { createHash, randomUUID } from 'node:crypto';
import {
  normalizePoolConfig,
  normalizeRecovery,
  configFingerprint,
  CircuitOpenError,
  InputError,
  type Admission,
  type ClientBackend,
  type Operations,
  type PoolConfig,
  type Snapshot,
  type OperationToken,
  type ControlSnapshot,
} from '@semaphile/core/client';
import { Wire, abortError, type TimedReply } from './wire.js';
import { decodeControl, controlSnapshot, controlResult } from './control-codec.js';

export type OpenOptions = {
  /** Refuse missing state instead of creating it; useful for administration. */
  create?: boolean;
  url: string;
  pool: string;
  telemetry?: TelemetryOptions;
  namespace?: string;
  config: PoolConfig;
  ownerTimeoutMs?: number;
};
type Pending = {
  weight: number;
  expirationMs: number | null;
  operation: OperationToken;
  autoFinish: boolean;
  circuit?: 'wait' | 'fail-fast';
  signal?: AbortSignal;
  cleanup: () => void;
  resolve: (admission: Admission) => void;
  reject: (error: unknown) => void;
};
type WireLease = { owner: string; weight: string; expires: string | null; granted: string };

export class RedisBackend implements ClientBackend {
  readonly maxConcurrent;
  readonly expirationMs;
  readonly recovery;
  private readonly fingerprint: string;
  readonly wire: Wire;
  private readonly pending: Pending[] = [];
  private readonly leaseExpiryBounds = new Map<string, number>();
  private preparation: Promise<void> = Promise.resolve();
  private pumping: Promise<void> | undefined;
  private closing = false;
  private readonly closingSignal = new AbortController();
  private readonly acquisitions = new Set<Promise<unknown>>();
  private readonly controlWaits = new Set<Promise<unknown>>();
  get failure(): Error | undefined {
    return this.wire.failure;
  }

  constructor(options: OpenOptions) {
    if (options.create !== undefined && typeof options.create !== 'boolean') {
      throw new TypeError('Invalid create option');
    }
    const config = normalizePoolConfig(options.config),
      { ownerTimeoutMs = 30000, namespace = 'semaphile' } = options;
    if (
      !Number.isSafeInteger(ownerTimeoutMs) ||
      ownerTimeoutMs < 300 ||
      ownerTimeoutMs > 2147483647
    ) {
      throw new RangeError('Invalid ownerTimeoutMs');
    }
    if (
      typeof options.pool !== 'string' ||
      !options.pool.length ||
      typeof namespace !== 'string' ||
      !namespace.length
    ) {
      throw new TypeError('Redis pool and namespace must be nonempty strings');
    }
    if (!['redis:', 'rediss:'].includes(new URL(options.url).protocol)) {
      throw new TypeError('Redis URL must use redis: or rediss:');
    }
    const identity = createHash('sha256')
      .update(JSON.stringify([namespace, options.pool]))
      .digest('hex');
    this.maxConcurrent = config.maxConcurrent;
    this.expirationMs = config.expirationMs;
    this.recovery = normalizeRecovery(config.recovery);
    this.fingerprint = configFingerprint({ ...config, ownerTimeoutMs });
    this.wire = new Wire(
      options.url,
      `semaphile:{${identity}}:state`,
      JSON.stringify({ ...config, ownerTimeoutMs }),
      ownerTimeoutMs,
      options.create ?? true,
      { namespace, pool: options.pool },
    );
  }
  async open(): Promise<void> {
    await this.wire.open();
    if (this.failure) {
      throw this.failure;
    }
  }

  call<K extends keyof Operations>(
    action: K,
    input: Operations[K]['input'],
    signal?: AbortSignal,
  ): Promise<Operations[K]['output']> {
    if (this.closing) {
      return Promise.reject(new Error('Redis limiter is closed'));
    }
    let result: Promise<unknown>;
    if (action === 'acquire') {
      result = this.acquire(input as Operations['acquire']['input'], signal);
    } else if (action === 'release') {
      const { lease, outcome } = input as Operations['release']['input'];
      result = this.wire.invoke('release', { lease, outcome }).then(() => {
        this.leaseExpiryBounds.delete(lease);
        return null;
      });
    } else if (action === 'accept' || action === 'finish') {
      result = this.wire.invoke(action, input).then(({ reply }) => decodeControl(reply.value));
    } else if (action === 'control') {
      result = this.wire
        .invoke('control', input)
        .then(({ reply }) => controlResult(reply.value, this.fingerprint));
    } else if (action === 'waitDrain') {
      result = this.waitForDrain((input as Operations['waitDrain']['input']).generation, signal);
    } else if (action === 'inspect') {
      result = this.wire.invoke('inspect').then((result) => this.snapshot(result));
    } else if (action === 'reservoir' || action === 'increment') {
      result = this.wire
        .invoke(action, input)
        .then(({ reply }) => (reply.value === null ? null : Number(reply.value)));
    } else {
      result = Promise.reject(new Error('Unsupported backend operation'));
    }
    return result as Promise<Operations[K]['output']>;
  }
  private acquire(input: Operations['acquire']['input'], signal?: AbortSignal): Promise<Admission> {
    // Reserve submission order before preflight/acceptance can suspend. Release
    // this position at enqueue, so waiting for admission never blocks preparation.
    const previous = this.preparation;
    let prepared!: () => void;
    const position = new Promise<void>((resolve) => {
      prepared = resolve;
    });
    this.preparation = previous.then(() => position);
    const task = this.acquireAccepted(
      { ...input, ...(input.operation ? { operation: { ...input.operation } } : {}) },
      previous,
      prepared,
      signal,
    ).finally(prepared);
    this.acquisitions.add(task);
    void task.finally(() => this.acquisitions.delete(task)).catch(() => {});
    return task;
  }
  private async acquireAccepted(
    input: Operations['acquire']['input'],
    previous: Promise<void>,
    prepared: () => void,
    signal?: AbortSignal,
  ): Promise<Admission> {
    signal = signal
      ? AbortSignal.any([signal, this.closingSignal.signal])
      : this.closingSignal.signal;
    if (signal?.aborted) {
      throw abortError();
    }
    if (this.failure) {
      throw this.failure;
    }
    if (input.circuit === 'fail-fast') {
      const { reply } = await this.wire.invoke('control', { command: { action: 'status' } });
      const status = controlSnapshot(reply.value, this.fingerprint);
      if (status.recovery.circuit !== 'closed') {
        throw new CircuitOpenError(
          Math.max(
            status.recovery.cooldownUntil,
            status.recovery.openUntil,
            status.recovery.probe?.expiresAt ?? 0,
          ),
        );
      }
    }
    const implicit = input.operation === undefined;
    const operation =
      input.operation ??
      (decodeControl(
        (await this.wire.invoke('accept', { operationId: randomUUID() })).reply.value,
      ) as OperationToken);
    try {
      await previous;
      if (signal.aborted) {
        throw abortError();
      }
      const admission = this.enqueue(
        { ...input, operation, autoFinish: implicit || input.autoFinish === true },
        signal,
      );
      prepared();
      return await admission;
    } catch (error) {
      if (implicit && !this.failure) {
        try {
          await this.wire.invoke('finish', { operation });
        } catch (cleanupError) {
          // Keep the acquisition error for its caller; uncertain cleanup makes
          // the backend unusable and remains available through failure.
          this.wire.fail(cleanupError);
        }
      }
      throw error;
    }
  }
  private enqueue(
    input: Omit<Pending, 'signal' | 'resolve' | 'reject' | 'cleanup'>,
    signal: AbortSignal,
  ): Promise<Admission> {
    const result = new Promise<Admission>((resolve, reject) => {
      const entry: Pending = {
        ...input,
        signal,
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener('abort', abort),
      };
      const abort = () => {
        const index = this.pending.indexOf(entry);
        if (index < 0) {
          return;
        }
        this.pending.splice(index, 1);
        entry.cleanup();
        reject(abortError());
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.push(entry);
    });
    this.start();
    return result;
  }
  private start(): void {
    this.pumping ??= this.pump().finally(() => {
      this.pumping = undefined;
      if (this.pending.length) {
        this.start();
      }
    });
  }
  private async pump(): Promise<void> {
    while (this.pending.length) {
      const entry = this.pending.shift()!;
      entry.cleanup();
      try {
        entry.resolve(await this.admit(entry));
      } catch (error) {
        entry.reject(error);
      }
    }
  }
  private async admit(entry: Pending): Promise<Admission> {
    const lease = randomUUID();
    while (true) {
      if (entry.signal?.aborted) {
        throw abortError();
      }
      const observed = this.wire.version;
      const result = await this.wire.invoke('acquire', {
        lease,
        weight: entry.weight,
        expirationMs: entry.expirationMs,
        operation: entry.operation,
        autoFinish: entry.autoFinish,
        circuit: entry.circuit,
      });
      if (result.reply.circuit && result.reply.circuit !== 'closed') {
        this.rejectCircuitWaiters(
          result.reply.recoveryDeadline == null ? null : Number(result.reply.recoveryDeadline),
        );
      }
      const granted = result.reply.admission;
      if (granted) {
        const admission = {
          leaseId: granted.leaseId,
          leaseGrantedAt: Number(granted.leaseGrantedAt),
          expiresAt: granted.expiresAt === null ? null : Number(granted.expiresAt),
          weight: Number(granted.weight),
        };
        const expiry =
          admission.expiresAt === null
            ? Infinity
            : result.sent + admission.expiresAt - Number(result.reply.now);
        this.leaseExpiryBounds.set(lease, expiry);
        // Resolve even after queued cancellation: the shared client must release
        // this late grant before its close promise can settle.
        return admission;
      }
      const deadline =
        result.reply.deadline === null
          ? undefined
          : result.received + Number(result.reply.deadline) - Number(result.reply.now);
      await this.wire.wait(observed, deadline, entry.signal);
    }
  }
  private rejectCircuitWaiters(notBefore: number | null): void {
    for (let index = this.pending.length - 1; index >= 0; index--) {
      if (this.pending[index].circuit !== 'fail-fast') {
        continue;
      }
      const [entry] = this.pending.splice(index, 1);
      entry.cleanup();
      entry.reject(new CircuitOpenError(notBefore));
    }
  }
  private waitForDrain(generation: number, signal?: AbortSignal): Promise<ControlSnapshot> {
    const task = this.waitUntilDrained(
      generation,
      signal ? AbortSignal.any([signal, this.closingSignal.signal]) : this.closingSignal.signal,
    );
    this.controlWaits.add(task);
    void task.finally(() => this.controlWaits.delete(task)).catch(() => {});
    return task;
  }
  private async waitUntilDrained(
    generation: number,
    signal: AbortSignal,
  ): Promise<ControlSnapshot> {
    while (true) {
      if (signal.aborted) {
        throw abortError();
      }
      const observed = this.wire.version;
      const result = await this.wire.invoke('control', { command: { action: 'status' } });
      if (signal.aborted) {
        throw abortError();
      }
      const status = controlSnapshot(result.reply.value, this.fingerprint);
      if (status.maintenance.mode !== 'draining' || status.maintenance.generation !== generation) {
        throw new InputError('Stale maintenance generation');
      }
      if (status.maintenance.settled) {
        return status;
      }
      const deadline =
        result.reply.deadline === null
          ? undefined
          : result.received + Number(result.reply.deadline) - Number(result.reply.now);
      await this.wire.wait(observed, deadline, signal);
    }
  }
  isExpired(admission: Admission): boolean {
    return (
      performance.now() >=
      Math.min(
        this.leaseExpiryBounds.get(admission.leaseId) ?? -Infinity,
        this.wire.ownerValidUntilMonotonic,
      )
    );
  }
  private snapshot({ reply }: TimedReply): Snapshot {
    const value = reply.value as {
      active: string;
      reservoir: string | null;
      leases: Record<string, WireLease>;
    };
    return {
      active: Number(value.active),
      reservoir: value.reservoir === null ? null : Number(value.reservoir),
      leases: Object.entries(value.leases).map(([id, lease]) => ({
        id,
        owner: lease.owner,
        weight: Number(lease.weight),
        expires: lease.expires === null ? null : Number(lease.expires),
      })),
      trace: [],
    };
  }
  async detach(): Promise<void> {
    this.closing = true;
    this.closingSignal.abort();
    await Promise.allSettled([...this.controlWaits, ...this.acquisitions]);
    await this.pumping;
    await this.wire.close();
  }
}
