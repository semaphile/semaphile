import { observeCurrent, settleCurrent } from './telemetry.js';
// Scoped processing and fetch-style delivery share one retry engine. Once a
// response reaches application code its execution can report, but never replay.
import type { ClientBackend } from './client.js';
import type { AttemptContext, ExecuteOptions, ExecutionPolicy } from './execution.js';
import { AttemptTimeoutError, ExecutionTimeoutError } from './client-errors.js';
import type { Outcome } from './recovery-state.js';
import { normalizeRecovery, recoveryConfig } from './recovery-policy.js';
import { httpClassifierId, responseOutcome, transportOutcome } from './http-policy.js';
import { responseLifetime } from './response-lifetime.js';
export type HttpInput = string | URL | Request;
export type HttpOptions = Omit<ExecuteOptions<unknown>, 'classifier' | 'policy'> & {
  request?: RequestInit;
  bodyFactory?: (attempt: number) => RequestInit['body'] | Promise<RequestInit['body']>;
  policy?: Omit<ExecutionPolicy, 'classifierId'>;
};
export interface HttpClient {
  request<T>(
    input: HttpInput,
    handler: (response: Response, context: AttemptContext) => T | PromiseLike<T>,
    options?: HttpOptions,
  ): Promise<T>;
  fetch(input: HttpInput, options?: HttpOptions): Promise<Response>;
}
type Execute = <T>(
  task: (context: AttemptContext) => T | PromiseLike<T>,
  options: ExecuteOptions<T>,
) => Promise<T>;

function bodyCopy(body: RequestInit['body']): RequestInit['body'] {
  if (body == null || typeof body === 'string' || body instanceof Blob) {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return new URLSearchParams(body);
  }
  if (body instanceof ArrayBuffer) {
    return body.slice(0);
  }
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  }
  if (body instanceof FormData) {
    const copy = new FormData();
    for (const [key, value] of body) {
      copy.append(key, value);
    }
    return copy;
  }
  throw new TypeError('Automatic HTTP replay requires a reproducible body or bodyFactory');
}
export function createHttpClient(backend: ClientBackend, execute: Execute): HttpClient {
  function start<T>(
    input: HttpInput,
    handler: ((response: Response, context: AttemptContext) => T | PromiseLike<T>) | undefined,
    options: HttpOptions = {},
  ): Promise<T | Response> {
    const submittedAt = performance.now();
    let delivered = false,
      retryAllowed = true,
      outcome: Outcome = { kind: 'neutral' };
    let resolveResponse!: (response: Response) => void, rejectResponse!: (error: unknown) => void;
    const responseResult = new Promise<Response>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });
    // The unused fetch-style result in scoped mode must never leak a rejection.
    void responseResult.catch(() => {});
    try {
      if (handler !== undefined && typeof handler !== 'function') {
        throw new TypeError('HTTP handler must be a function');
      }
      const base = recoveryConfig(backend.recovery ?? normalizeRecovery());
      if (base.classifierId !== 'semaphile.generic/1' && base.classifierId !== httpClassifierId) {
        throw new TypeError('HTTP helper requires the built-in HTTP classifier policy');
      }
      const policy = normalizeRecovery({
        ...base,
        ...options.policy,
        classifierId: httpClassifierId,
        retry: { ...base.retry, ...options.policy?.retry },
      });
      const safe = options.retrySafety === 'safe';
      const init = {
        ...options.request,
        headers: options.request?.headers && new Headers(options.request.headers),
      };
      const factory = options.bodyFactory;
      const inputSignal = input instanceof Request ? input.signal : undefined;
      const signal = AbortSignal.any([
        ...(options.signal ? [options.signal] : []),
        ...(init.signal ? [init.signal] : []),
        ...(inputSignal ? [inputSignal] : []),
      ]);
      // Input Request streams have no reproducibility guarantee. Explicit bodies
      // are snapshotted before queueing; a factory owns reproduction each attempt.
      const suppliedBody = init.body ?? (input instanceof Request ? input.body : null);
      const body = safe && !factory ? bodyCopy(suppliedBody) : init.body;
      const execution = execute<T | Response | undefined>(
        async (context) => {
          const attemptStartedAt = performance.now();
          const checkDelivery = () => {
            if (context.signal.aborted) {
              throw context.signal.reason;
            }
            if (
              policy.deadlineMs !== null &&
              performance.now() >= submittedAt + policy.deadlineMs
            ) {
              throw new ExecutionTimeoutError(policy.deadlineMs);
            }
            if (
              policy.attemptTimeoutMs !== null &&
              performance.now() >= attemptStartedAt + policy.attemptTimeoutMs
            ) {
              throw new AttemptTimeoutError(policy.attemptTimeoutMs);
            }
          };
          checkDelivery();
          outcome = { kind: 'neutral' };
          const attemptBody = factory
            ? await factory(context.attempt)
            : safe
              ? bodyCopy(body)
              : body;
          checkDelivery();
          const request = new Request(input, {
            ...init,
            ...(attemptBody !== undefined ? { body: attemptBody } : {}),
            signal: context.signal,
          });
          checkDelivery();
          let original: Response;
          try {
            observeCurrent('requestStarted', { attempt: context.attempt });
            original = await globalThis.fetch(request);
            observeCurrent('responseStarted', { attempt: context.attempt, code: original.status });
          } catch (error) {
            outcome = transportOutcome(error, context.signal);
            throw error;
          }
          try {
            checkDelivery();
          } catch (error) {
            await original.body?.cancel(error);
            throw error;
          }
          outcome = responseOutcome(original);
          const bodyOutcome = (error: unknown): Outcome =>
            outcome.kind === 'throttle' || outcome.kind === 'service-failure'
              ? outcome
              : transportOutcome(error, context.signal);
          const transient = outcome.kind === 'throttle' || outcome.kind === 'service-failure';
          if (safe && transient && context.attempt < policy.retry.maxAttempts) {
            try {
              await original.body?.cancel();
              observeCurrent(original.body ? 'responseCancelled' : 'responseCompleted', {
                attempt: context.attempt,
              });
            } catch (error) {
              observeCurrent('responseFailed', { attempt: context.attempt, status: 'rejected' });
              retryAllowed = false;
              throw error;
            }
            return undefined;
          }
          const lifetime = responseLifetime(original, context.signal);
          void lifetime.finished.then(
            () => {
              observeCurrent(lifetime.cancelled ? 'responseCancelled' : 'responseCompleted', {
                attempt: context.attempt,
              });
            },
            () =>
              observeCurrent('responseFailed', { attempt: context.attempt, status: 'rejected' }),
          );
          try {
            checkDelivery();
          } catch (error) {
            await lifetime.cancel(error);
            throw error;
          }
          delivered = true;
          if (!handler) {
            settleCurrent('fulfilled');
            resolveResponse(lifetime.response);
            try {
              await lifetime.finished;
            } catch (error) {
              outcome = bodyOutcome(error);
              throw error;
            }
            if (lifetime.cancelled && outcome.kind === 'success') {
              outcome = { kind: 'neutral' };
            }
            return lifetime.response;
          }
          let value!: T, failure: { error: unknown } | undefined;
          try {
            value = await handler(lifetime.response, context);
          } catch (error) {
            if (error === lifetime.failure) {
              outcome = bodyOutcome(error);
            } else if (outcome.kind === 'success') {
              outcome = { kind: 'neutral' };
            }
            failure = { error };
          }
          try {
            await lifetime.cancel();
          } catch (error) {
            outcome = bodyOutcome(error);
            failure = {
              error:
                failure && failure.error !== error
                  ? new AggregateError(
                      [failure.error, error],
                      'HTTP handler and body cleanup failed',
                    )
                  : error,
            };
          }
          if (lifetime.cancelled && outcome.kind === 'success') {
            outcome = { kind: 'neutral' };
          }
          if (failure) {
            throw failure.error;
          }
          return value;
        },
        {
          ...options,
          signal,
          policy: { ...options.policy, classifierId: httpClassifierId },
          classifier: {
            id: httpClassifierId,
            classify: () => ({ ...outcome, retry: !delivered && retryAllowed }),
          },
        },
      );
      const terminal = execution.then((value) => {
        if (!delivered) {
          throw new Error('HTTP execution stopped before response delivery');
        }
        return value;
      });
      if (handler) {
        return terminal as Promise<T>;
      }
      void terminal.catch((error) => {
        if (!delivered) {
          rejectResponse(error);
        }
      });
      return responseResult;
    } catch (error) {
      return Promise.reject(error);
    }
  }
  return {
    request: <T>(
      input: HttpInput,
      handler: (response: Response, context: AttemptContext) => T | PromiseLike<T>,
      options?: HttpOptions,
    ) => start(input, handler, options) as Promise<T>,
    fetch: (input, options) => start(input, undefined, options) as Promise<Response>,
  };
}
