# @semaphile/otel

Optional OpenTelemetry instrumentation and shared-pool monitoring for Semaphile.
Use matching 0.2.0 Semaphile packages and an application-owned OpenTelemetry SDK.

```sh
npm install @semaphile/otel@0.2.0 @opentelemetry/api@^1.9.0
```

- Main entry: `createInstrumentation()` integrates with an application-owned SDK.
- `@semaphile/otel/messaging`: `createMessagingInstrumentation()` traces message lifecycles.
- `@semaphile/otel/sdk`: explicit standalone OTLP HTTP/protobuf SDK setup.
- `@semaphile/otel/collector`: `startCollector()` serves shared-pool metrics and health.
- `@semaphile/otel/cli`: implementation of `semaphile telemetry collect`.

See [observability](../../docs/observability.md) for lifecycle semantics, configuration,
collector ownership, overlap warnings, and CLI examples. SDK/exporter code is not
loaded by the main adapter entry point. Core users do not install this package
unless they opt into OpenTelemetry.
