// A monotonic deadline owns one computed timer. Re-arm only if a runtime delivers
// that timer early, never periodically to inspect admission state.
export function deadline(at: number | null, expire: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const check = () => {
    if (stopped || at === null) {
      return;
    }
    clearTimeout(timer);
    const remaining = at - performance.now();
    if (remaining <= 0) {
      stopped = true;
      expire();
    } else {
      timer = setTimeout(check, Math.min(2_147_483_647, Math.ceil(remaining)));
    }
  };
  check();
  return {
    check,
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
export function delayUntil(at: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof deadline> | undefined;
    const cleanup = () => {
      timer?.stop();
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    timer = deadline(at, () => {
      cleanup();
      resolve();
    });
  });
}
