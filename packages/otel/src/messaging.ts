// Application-owned messaging instrumentation. Remote sender context is a link;
// each processing attempt keeps its own ambient parent and active handler span.
import {
  context,
  propagation,
  trace,
  metrics,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  defaultTextMapGetter,
  defaultTextMapSetter,
  type Tracer,
  type Meter,
} from '@opentelemetry/api';
import { createPropagator } from './propagation.js';
export interface TraceCarrier {
  traceparent?: string;
  tracestate?: string;
  baggage?: string;
}
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
    operation: 'send' | 'receive' | 'wait' | 'process' | 'ack' | 'release' | 'renew' | 'fail';
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
export function createMessagingInstrumentation(
  options: { tracer?: Tracer; meter?: Meter; baggageAllowlist?: string[] } = {},
): MessageInstrumentation {
  const tracer = options.tracer ?? trace.getTracer('@semaphile/otel');
  const meter = options.meter ?? metrics.getMeter('@semaphile/otel');
  const propagator = createPropagator(options.baggageAllowlist);
  const count = meter.createCounter('semaphile.messaging.operations');
  const duration = meter.createHistogram('semaphile.messaging.duration', { unit: 's' });
  const remote = (carrier?: TraceCarrier) =>
    propagator.extract(ROOT_CONTEXT, carrier ?? {}, defaultTextMapGetter);
  return {
    start(event) {
      const sender = remote(event.trace),
        linked = trace.getSpanContext(sender);
      const attributes = {
        'messaging.system': 'semaphile',
        'messaging.operation.name': event.operation,
        ...(event.messageId ? { 'messaging.message.id': event.messageId } : {}),
        ...(event.deliveryId ? { 'semaphile.delivery.id': event.deliveryId } : {}),
        ...(event.correlationId
          ? { 'messaging.message.conversation_id': event.correlationId }
          : {}),
        ...(event.attempt ? { 'semaphile.delivery.attempt': event.attempt } : {}),
      };
      const span = tracer.startSpan(`semaphile message ${event.operation}`, {
        kind:
          event.operation === 'send'
            ? SpanKind.PRODUCER
            : ['process', 'receive', 'wait'].includes(event.operation)
              ? SpanKind.CONSUMER
              : SpanKind.INTERNAL,
        attributes,
        startTime: new Date(event.at),
        links: linked ? [{ context: linked }] : [],
      });
      let active = trace.setSpan(context.active(), span);
      const baggage = propagation.getBaggage(sender);
      if (event.trace && baggage) {
        active = propagation.setBaggage(active, baggage);
      }
      const inject = () => {
        const carrier: TraceCarrier = {};
        propagator.inject(active, carrier, defaultTextMapSetter);
        return carrier;
      };
      return {
        run: (callback) => context.with(active, callback),
        inject,
        received(messages) {
          for (const message of messages.slice(0, 1000)) {
            const linked = trace.getSpanContext(remote(message.trace));
            if (linked) {
              span.addLink({
                context: linked,
                attributes: message.messageId ? { 'messaging.message.id': message.messageId } : {},
              });
            }
          }
        },
        end(result) {
          const labels = {
            'messaging.operation.name': event.operation,
            'semaphile.outcome': result.status ?? 'fulfilled',
          };
          count.add(1, labels);
          duration.record((result.durationMs ?? 0) / 1000, labels);
          if (result.status === 'rejected') {
            span.setStatus({ code: SpanStatusCode.ERROR });
          }
          span.end();
        },
      };
    },
  };
}
/** Explicit CLI boundary for context supplied by a parent handler process. */
export function withMessageContext<T>(
  carrier: TraceCarrier,
  callback: () => T,
  baggageAllowlist: string[] = [],
): T {
  const ctx = createPropagator(baggageAllowlist).extract(
    context.active(),
    carrier,
    defaultTextMapGetter,
  );
  return context.with(ctx, callback);
}
