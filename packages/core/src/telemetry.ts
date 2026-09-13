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
  | 'responseFailed'
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

export function settleCurrent(status: 'fulfilled' | 'rejected' | 'cancelled'): void {
  current.getStore()?.settle(status);
}
const thenable = (value: unknown): value is PromiseLike<unknown> =>
  value !== null &&
  (typeof value === 'object' || typeof value === 'function') &&
  'then' in value &&
  typeof value.then === 'function';
export class Telemetry {
  enabled = true;
  private diagnosticEnabled = true;
  /** Context adapters are synchronous. Disable a violating adapter after its
   * first promise so a hanging hook cannot allocate one promise per event/job. */
  checkHook(value: unknown): void {
    if (thenable(value)) {
      this.enabled = false;
      void Promise.resolve(value).catch(() => {});
      this.diagnostic('observer-failed');
    }
  }
  hook(callback: () => unknown): void {
    if (!this.enabled) {
      return;
    }
    try {
      this.checkHook(callback());
    } catch {
      this.diagnostic('observer-failed');
    }
  }
  private readonly options: TelemetryOptions;
  private readonly queue: LifecycleEvent[] = [];
  private scheduled = false;
  private readonly capacity: number;
  constructor(
    readonly backend: string,
    options: TelemetryOptions = {},
  ) {
    try {
      this.options = { ...options };
    } catch {
      this.options = {};
    }
    options = this.options;
    this.capacity =
      Number.isSafeInteger(options.bufferSize) && options.bufferSize! > 0
        ? Math.min(options.bufferSize!, 65536)
        : 1024;
  }
  diagnostic(kind: 'observer-failed' | 'events-dropped', count = 1): void {
    if (!this.diagnosticEnabled) {
      return;
    }
    try {
      const result = this.options.onDiagnostic?.({ kind, count });
      if (thenable(result)) {
        this.diagnosticEnabled = false;
        void Promise.resolve(result).catch(() => {});
      }
    } catch {
      /* Diagnostics are observational. */
    }
  }
  begin(operation: string): Observation {
    return new Observation(
      this,
      operation,
      this.options.pool,
      this.enabled ? this.options.instrumentation : undefined,
    );
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
      const scope = instrumentation?.start(event);
      owner.checkHook(scope);
      if (owner.enabled) {
        this.scope = scope;
      }
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
    this.owner.hook(() => this.scope?.event?.(event));
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
      if (this.owner.enabled && this.scope?.run) {
        const returned = this.scope.run(once);
        if (returned !== result) {
          this.owner.checkHook(returned);
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
  end(status?: 'fulfilled' | 'rejected' | 'cancelled'): void {
    if (this.ended) {
      return;
    }
    this.emit('completed', { status });
    this.ended = true;
    this.owner.hook(() => this.scope?.end?.(this.make('completed', { status })));
  }
}
