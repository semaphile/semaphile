// A response is delivered before its body finishes. The execution retains its
// lease through EOF or completion of reader cancellation, including locked bodies.
export function responseLifetime(original: Response, signal: AbortSignal) {
  if (!original.body) {
    return {
      response: original,
      finished: Promise.resolve(),
      cancel: async () => {},
      failure: undefined as unknown,
      cancelled: false,
    };
  }
  const reader = original.body.getReader();
  let resolveFinished!: () => void, rejectFinished!: (error: unknown) => void;
  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });
  void finished.catch(() => {});
  let settled = false,
    cancelled = false,
    cancellation: Promise<void> | undefined;
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  let failure: unknown;
  const end = (error?: { value: unknown }) => {
    if (settled) {
      return;
    }
    settled = true;
    signal.removeEventListener('abort', abort);
    if (error) {
      failure = error.value;
      rejectFinished(error.value);
    } else {
      resolveFinished();
    }
  };
  const cancel = (reason?: unknown): Promise<void> => {
    if (settled) {
      return finished;
    }
    if (!cancellation) {
      cancelled = true;
      // Error the exposed stream even if application code currently owns a reader.
      streamController.error(reason ?? new Error('Response body scope ended'));
      cancellation = reader.cancel(reason).then(
        () => end(),
        (error) => {
          end({ value: error });
          throw error;
        },
      );
      void cancellation.catch(() => {});
    }
    return cancellation;
  };
  const abort = () => {
    void cancel(signal.reason).catch(() => {});
  };
  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        streamController = controller;
      },
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (cancelled) {
            return;
          }
          if (chunk.done) {
            controller.close();
            end();
          } else {
            controller.enqueue(chunk.value);
          }
        } catch (error) {
          if (!settled && !cancelled) {
            controller.error(error);
            end({ value: error });
          }
        }
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  // Source EOF also completes an unread empty body. A pending read may still
  // deliver its final chunk; only cancellation prevents forwarding that chunk.
  void reader.closed.then(
    () => {
      if (!cancelled) {
        end();
      }
    },
    (error) => {
      if (!settled && !cancelled) {
        streamController.error(error);
        end({ value: error });
      }
    },
  );
  const response = new Response(body, {
    status: original.status,
    statusText: original.statusText,
    headers: original.headers,
  });
  Object.defineProperties(response, {
    url: { value: original.url },
    redirected: { value: original.redirected },
    type: { value: original.type },
  });
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) {
    abort();
  }
  return {
    response,
    finished,
    cancel,
    get cancelled() {
      return cancelled;
    },
    get failure() {
      return failure;
    },
  };
}
