// Library-neutral lifecycle hooks. Only context binding is synchronous; optional
// event subscribers drain a bounded queue outside coordination and user callbacks.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export type LifecycleKind =
  | 'queued'
  | 'leaseGranted'
  | 'attemptStarted'
  | 'attemptCompleted'
  | 'leaseReleased'
  | 'retryScheduled'
  | 'callerSettled'
  | 'completed'
  | 'requestStarted'
  | 'responseStarted'
  | 'responseCompleted'
  | 'responseCancelled'
  | 'stateObserved';
export type LifecycleEvent = Readonly<{
  id: string;
  operation: string;
  backend: string;
  pool?: string;
  kind: LifecycleKind;
  at: number;
  elapsedMs: number;
  attempt?: number;
  status?: 'fulfilled' | 'rejected' | 'cancelled';
  durationMs?: number;
  delayMs?: number;
  weight?: number;
  code?: number;
  state?: string;
}>;
export interface InstrumentationScope {
  /** Invoke callback exactly once in the captured tracing context. */
  run?<T>(callback: () => T): T;
  event?(event: LifecycleEvent): void;
  end?(event: LifecycleEvent): void;
}
export interface Instrumentation {
  start(event: LifecycleEvent): InstrumentationScope;
}
export type TelemetryOptions = {
  /** A stable, low-cardinality name. Raw store paths are never inferred. */
  pool?: string;
  instrumentation?: Instrumentation;
  onEvent?: (event: LifecycleEvent) => void | Promise<void>;
  onDiagnostic?: (diagnostic: {
    kind: 'observer-failed' | 'events-dropped';
    count: number;
  }) => void;
  bufferSize?: number;
};
const current = new AsyncLocalStorage<Observation>();
export function observeCurrent(kind: LifecycleKind, fields: Partial<LifecycleEvent> = {}): void {
  current.getStore()?.emit(kind, fields);
}

export class Telemetry {
  private readonly options: TelemetryOptions;
  private readonly queue: LifecycleEvent[] = [];
  private scheduled = false;
  private readonly capacity: number;
  constructor(
    readonly backend: string,
    options: TelemetryOptions = {},
  ) {
    this.options = { ...options };
    this.capacity =
      Number.isSafeInteger(options.bufferSize) && options.bufferSize! > 0
        ? Math.min(options.bufferSize!, 65536)
        : 1024;
  }
  diagnostic(kind: 'observer-failed' | 'events-dropped', count = 1): void {
    try {
      void Promise.resolve(this.options.onDiagnostic?.({ kind, count })).catch(() => {});
    } catch {
      /* Diagnostics are observational. */
    }
  }
  begin(operation: string): Observation {
    return new Observation(this, operation, this.options.pool, this.options.instrumentation);
  }
  publish(event: LifecycleEvent): void {
    if (!this.options.onEvent) {
      return;
    }
    if (this.queue.length >= this.capacity) {
      this.diagnostic('events-dropped');
      return;
    }
    this.queue.push(event);
    this.scheduleDrain();
  }
  private scheduleDrain(): void {
    if (this.scheduled || !this.queue.length) {
      return;
    }
    this.scheduled = true;
    setImmediate(() => {
      void this.drain();
    });
  }
  private async drain(): Promise<void> {
    // One bounded batch and at most one outstanding observer promise. A hanging
    // observer stalls only telemetry; subsequent events fill/drop within the cap.
    const events = this.queue.splice(0);
    for (const event of events) {
      try {
        await this.options.onEvent!(event);
      } catch {
        this.diagnostic('observer-failed');
      }
    }
    this.scheduled = false;
    this.scheduleDrain();
  }
}
export class Observation {
  private readonly id = randomUUID();
  private readonly started = performance.now();
  private readonly scope?: InstrumentationScope;
  private ended = false;
  private settled = false;
  constructor(
    private readonly owner: Telemetry,
    private readonly operation: string,
    private readonly pool: string | undefined,
    instrumentation?: Instrumentation,
  ) {
    const event = this.make('queued');
    try {
      this.scope = instrumentation?.start(event);
    } catch {
      owner.diagnostic('observer-failed');
    }
    this.emit('queued');
  }
  private make(kind: LifecycleKind, fields: Partial<LifecycleEvent> = {}): LifecycleEvent {
    return Object.freeze({
      ...fields,
      id: this.id,
      operation: this.operation,
      backend: this.owner.backend,
      pool: this.pool,
      kind,
      at: Date.now(),
      elapsedMs: performance.now() - this.started,
    });
  }
  emit(kind: LifecycleKind, fields: Partial<LifecycleEvent> = {}): void {
    if (this.ended) {
      return;
    }
    const event = this.make(kind, fields);
    try {
      void Promise.resolve(this.scope?.event?.(event)).catch(() =>
        this.owner.diagnostic('observer-failed'),
      );
    } catch {
      this.owner.diagnostic('observer-failed');
    }
    this.owner.publish(event);
  }
  run<T>(callback: () => T): T {
    // A broken adapter cannot invoke work twice, swallow its exception, or replace
    // its return value. Fall back only when the adapter never invoked the work.
    let invoked = false,
      result!: T,
      failure: { error: unknown } | undefined;
    const once = () => {
      if (!invoked) {
        invoked = true;
        try {
          result = current.run(this, callback);
        } catch (error) {
          failure = { error };
        }
      }
      if (failure) {
        throw failure.error;
      }
      return result;
    };
    try {
      if (this.scope?.run) {
        const returned = this.scope.run(once);
        if (returned !== result) {
          void Promise.resolve(returned).catch(() => this.owner.diagnostic('observer-failed'));
        }
      } else {
        once();
      }
    } catch {
      if (!failure) {
        this.owner.diagnostic('observer-failed');
      }
    }
    if (!invoked) {
      once();
    }
    if (failure) {
      throw failure.error;
    }
    return result;
  }
  settle(status: 'fulfilled' | 'rejected' | 'cancelled'): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.emit('callerSettled', { status });
  }
  end(): void {
    if (this.ended) {
      return;
    }
    this.emit('completed');
    this.ended = true;
    try {
      void Promise.resolve(this.scope?.end?.(this.make('completed'))).catch(() =>
        this.owner.diagnostic('observer-failed'),
      );
    } catch {
      this.owner.diagnostic('observer-failed');
    }
  }
}
