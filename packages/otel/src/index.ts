// The library adapter depends only on the OTel API. SDK/exporter initialization
// lives in the explicit ./sdk entry point and is owned by the host application.
import {
  context,
  metrics,
  trace,
  SpanStatusCode,
  type Meter,
  type Tracer,
  type Span,
} from '@opentelemetry/api';
import type { Instrumentation, LifecycleEvent } from './types.js';
export type { Instrumentation, LifecycleEvent } from './types.js';
export function createInstrumentation(
  options: { tracer?: Tracer; meter?: Meter } = {},
): Instrumentation {
  const tracer = options.tracer ?? trace.getTracer('@semaphile/otel', '0.1.0');
  const meter = options.meter ?? metrics.getMeter('@semaphile/otel', '0.1.0');
  const events = meter.createCounter('semaphile.client.events', {
    description: 'Observed local lifecycle events',
  });
  const queued = meter.createUpDownCounter('semaphile.client.queued', {
    description: 'Locally queued attempts',
  });
  const running = meter.createUpDownCounter('semaphile.client.running', {
    description: 'Locally executing callbacks; not shared lease occupancy',
  });
  const queueTime = meter.createHistogram('semaphile.client.queue.duration', { unit: 's' });
  const runTime = meter.createHistogram('semaphile.client.execution.duration', { unit: 's' });
  return {
    start(initial) {
      const attributes = {
        'semaphile.backend': initial.backend,
        'semaphile.operation': initial.operation,
        ...(initial.pool ? { 'semaphile.pool': initial.pool.slice(0, 128) } : {}),
      };
      const span = tracer.startSpan(`semaphile ${initial.operation}`, {
        attributes,
        startTime: new Date(initial.at),
      });
      const bound = trace.setSpan(context.active(), span);
      let attempt: Span | undefined,
        waiting = false,
        executing = false,
        queueAt = 0;
      const stopWaiting = (event: LifecycleEvent) => {
        if (!waiting) {
          return;
        }
        waiting = false;
        queued.add(-1, attributes);
        queueTime.record(Math.max(0, event.elapsedMs - queueAt) / 1000, attributes);
      };
      return {
        run: (callback) => context.with(attempt ? trace.setSpan(bound, attempt) : bound, callback),
        event(event) {
          events.add(1, {
            ...attributes,
            'semaphile.event': event.kind,
            ...(event.status ? { 'semaphile.outcome': event.status } : {}),
          });
          const fields = {
            ...(event.attempt === undefined ? {} : { 'semaphile.attempt': event.attempt }),
            ...(event.code === undefined ? {} : { 'http.response.status_code': event.code }),
            ...(event.delayMs === undefined ? {} : { 'semaphile.retry.delay_ms': event.delayMs }),
            ...(event.status === undefined ? {} : { 'semaphile.outcome': event.status }),
            ...(event.state === undefined ? {} : { 'semaphile.state': event.state }),
          };
          span.addEvent(event.kind, fields, new Date(event.at));
          switch (event.kind) {
            case 'queued':
              if (!waiting) {
                waiting = true;
                queueAt = event.elapsedMs;
                queued.add(1, attributes);
              }
              break;
            case 'leaseGranted':
              stopWaiting(event);
              break;
            case 'attemptStarted':
              executing = true;
              running.add(1, attributes);
              attempt = tracer.startSpan('semaphile attempt', { attributes: fields }, bound);
              break;
            case 'attemptCompleted':
              if (executing) {
                executing = false;
                running.add(-1, attributes);
              }
              if (event.durationMs !== undefined) {
                runTime.record(event.durationMs / 1000, attributes);
              }
              if (event.status === 'rejected') {
                attempt?.setStatus({ code: SpanStatusCode.ERROR });
              }
              attempt?.end(new Date(event.at));
              attempt = undefined;
              break;
            case 'callerSettled':
              if (event.status === 'rejected') {
                span.setStatus({ code: SpanStatusCode.ERROR });
              }
              span.setAttribute('semaphile.caller.outcome', event.status ?? 'unknown');
              break;
          }
        },
        end(event) {
          if (event.status === 'rejected') {
            span.setStatus({ code: SpanStatusCode.ERROR });
          }
          stopWaiting(event);
          if (executing) {
            executing = false;
            running.add(-1, attributes);
          }
          attempt?.end(new Date(event.at));
          span.end(new Date(event.at));
        },
      };
    },
  };
}
