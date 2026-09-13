# @semaphile/otel

Optional OpenTelemetry instrumentation and shared-pool monitoring for Semaphile.
Unreleased: use matching local builds; this package is not yet published.

- Main entry: `createInstrumentation()` integrates with an application-owned SDK.
- `@semaphile/otel/sdk`: explicit standalone OTLP HTTP/protobuf SDK setup.
- `@semaphile/otel/collector`: `startCollector()` serves shared-pool metrics and health.
- `@semaphile/otel/cli`: implementation of `semaphile telemetry collect`.

See [observability](../../docs/observability.md) for lifecycle semantics, configuration,
collector ownership, overlap warnings, and CLI examples. SDK/exporter code is not
loaded by the main adapter entry point. Core users do not install this package
unless they opt into OpenTelemetry.
