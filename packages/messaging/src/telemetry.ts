// Synchronous context hooks are isolated from delivery. Their returned promises
// are never awaited; the first asynchronous hook disables that adapter.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { filterTrace, type TraceCarrier } from './trace.js';
export type MessageOperation =
  'send' | 'receive' | 'wait' | 'process' | 'ack' | 'release' | 'renew' | 'fail';
export type MessageMetadata = Readonly<{
  messageId?: string;
  deliveryId?: string;
  correlationId?: string;
  attempt?: number;
  trace?: TraceCarrier;
}>;
export type MessageEvent = MessageMetadata &
  Readonly<{
    id: string;
    operation: MessageOperation;
    at: number;
    status?: 'fulfilled' | 'rejected' | 'cancelled';
    durationMs?: number;
  }>;
export interface MessageScope {
  run?<T>(callback: () => T): T;
  inject?(): TraceCarrier | undefined;
  received?(messages: readonly MessageMetadata[]): void;
  end?(event: MessageEvent): void;
}
export interface MessageInstrumentation {
  start(event: MessageEvent): MessageScope;
}
export interface MessageTelemetryOptions {
  instrumentation?: MessageInstrumentation;
  baggageAllowlist?: string[];
  onDiagnostic?: (event: { kind: 'observer-failed' | 'trace-dropped' }) => void;
}
const active = new AsyncLocalStorage<{
  inject: () => TraceCarrier | undefined;
  fail: () => void;
}>();
/** Current processing span carrier for an explicitly launched handler process. */
export function currentMessageTrace(): TraceCarrier | undefined {
  return active.getStore()?.inject();
}
export function markMessageFailure(): void {
  active.getStore()?.fail();
}
export class MessageTelemetry {
  private disabled = false;
  private diagnosticDisabled = false;
  private readonly options: MessageTelemetryOptions;
  readonly baggageAllowlist: readonly string[];
  constructor(options?: MessageTelemetryOptions) {
    try {
      this.options = { ...options };
      const allowed = options?.baggageAllowlist ?? [];
      this.baggageAllowlist =
        Array.isArray(allowed) &&
        allowed.length <= 64 &&
        allowed.every((key) => typeof key === 'string' && key.length <= 128)
          ? [...allowed]
          : [];
    } catch {
      this.options = {};
      this.baggageAllowlist = [];
    }
  }
  diagnostic(kind: 'observer-failed' | 'trace-dropped'): void {
    if (this.diagnosticDisabled) {
      return;
    }
    try {
      const result = this.options.onDiagnostic?.({ kind }) as unknown;
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        this.diagnosticDisabled = true;
        void Promise.resolve(result).catch(() => {});
      }
    } catch {
      /* Diagnostic sinks cannot affect work. */
    }
  }
  hook<T>(callback: () => T): T | undefined {
    if (this.disabled) {
      return undefined;
    }
    try {
      const value = callback();
      if (value && typeof (value as unknown as PromiseLike<unknown>).then === 'function') {
        this.disabled = true;
        void Promise.resolve(value).catch(() => {});
        this.diagnostic('observer-failed');
        return undefined;
      }
      return value;
    } catch {
      this.diagnostic('observer-failed');
      return undefined;
    }
  }
  begin(operation: MessageOperation, metadata: MessageMetadata = {}, at = Date.now()) {
    const event: MessageEvent = Object.freeze({ ...metadata, id: randomUUID(), operation, at });
    const scope = this.hook(() => this.options.instrumentation?.start(event));
    const start = performance.now();
    let ended = false,
      failed = false;
    const inject = (): TraceCarrier | undefined => {
      const value = this.hook(() => scope?.inject?.());
      try {
        return filterTrace(value, this.baggageAllowlist);
      } catch {
        this.diagnostic('trace-dropped');
        return undefined;
      }
    };
    return {
      inject,
      received: (messages: readonly MessageMetadata[]) => {
        this.hook(() => scope?.received?.(messages));
      },
      run: <T>(callback: () => T): T => {
        let called = false,
          result!: T,
          failure: { value: unknown } | undefined;
        const once = () => {
          if (!called) {
            called = true;
            try {
              result = active.run(
                {
                  inject,
                  fail: () => {
                    failed = true;
                  },
                },
                callback,
              );
            } catch (value) {
              failure = { value };
            }
          }
          if (failure) {
            throw failure.value;
          }
          return result;
        };
        // A legitimate run hook may return the callback's promise. Only a
        // different promise is an asynchronous hook protocol violation.
        this.hook(() => {
          const returned = scope?.run?.(once);
          return returned === result ? undefined : returned;
        });
        if (!called) {
          once();
        }
        if (failure) {
          throw failure.value;
        }
        return result;
      },
      end: (status: 'fulfilled' | 'rejected' | 'cancelled') => {
        if (ended) {
          return;
        }
        ended = true;
        this.hook(() =>
          scope?.end?.(
            Object.freeze({
              ...event,
              status: failed ? 'rejected' : status,
              durationMs: performance.now() - start,
            }),
          ),
        );
      },
    };
  }
}
