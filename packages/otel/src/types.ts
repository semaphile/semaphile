// Structural lifecycle protocol: importing the adapter types requires no native package.
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
