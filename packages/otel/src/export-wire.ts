// Worker messages contain plain data; SDK resources and trace state have methods.
import { createTraceState, type SpanContext } from '@opentelemetry/api';
import { resourceFromAttributes, type Resource } from '@opentelemetry/resources';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-node';
export const packResource = (resource: Resource) => ({
  attributes: resource.attributes,
  schemaUrl: resource.schemaUrl,
});
export const unpackResource = (resource: ReturnType<typeof packResource>) =>
  resourceFromAttributes(resource.attributes, { schemaUrl: resource.schemaUrl });
const packContext = (context: SpanContext) => ({
  ...context,
  traceState: context.traceState?.serialize(),
});
const unpackContext = (context: ReturnType<typeof packContext>): SpanContext => ({
  ...context,
  traceState: context.traceState === undefined ? undefined : createTraceState(context.traceState),
});
export function packSpan(span: ReadableSpan) {
  return {
    name: span.name,
    kind: span.kind,
    context: packContext(span.spanContext()),
    parentSpanContext: span.parentSpanContext && packContext(span.parentSpanContext),
    startTime: span.startTime,
    endTime: span.endTime,
    status: span.status,
    attributes: span.attributes,
    links: span.links.map((link) => ({ ...link, context: packContext(link.context) })),
    events: span.events,
    duration: span.duration,
    ended: span.ended,
    resource: packResource(span.resource),
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
  };
}
export function unpackSpan(span: ReturnType<typeof packSpan>): ReadableSpan {
  const { context, ...data } = span;
  return {
    ...data,
    spanContext: () => unpackContext(context),
    parentSpanContext: data.parentSpanContext && unpackContext(data.parentSpanContext),
    links: data.links.map((link) => ({ ...link, context: unpackContext(link.context) })),
    resource: unpackResource(data.resource),
  };
}
