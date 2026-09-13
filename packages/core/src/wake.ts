// Native subscription starts its own dedicated OS wait thread. Closing it joins
// that thread; no descriptor transfer or extra JavaScript worker is involved.
import type { NativeSubscription } from './native.js';

export function waitForWake(
  subscription: NativeSubscription,
  deadline: number | undefined,
  onWait: () => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = deadline === undefined ? null : Math.max(0, Math.ceil(deadline - Date.now()));
    subscription.start(timeout, (error) => (error ? reject(error) : resolve()));
    onWait();
  });
}
