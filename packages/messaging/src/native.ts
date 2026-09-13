// Private Rust Node-API boundary. Native objects own every OS descriptor and wait.
export type NativeFileRole = 'file' | 'gate' | 'notification' | 'lifetime';
export interface NativeFile {
  withGate<T>(callback: () => T): T;
  lockLifetime(): void;
  pulse(): void;
  close(): void;
}
export interface NativeSubscription {
  watchOwner(pid: number): boolean;
  start(timeoutMs: number | null, completion: (error: Error | null, wake: number) => void): void;
  cancel(): void;
  close(): void;
}
export interface NativeContext {
  open(path: string, role: NativeFileRole): NativeFile;
  subscribe(path: string): NativeSubscription;
  alive(path: string): boolean;
  close(): void;
}
export interface Native {
  NativeContext: new () => NativeContext;
}
