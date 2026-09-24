# Documentation

These guides describe the current experimental implementation. They are intended
for readers who have no access to development conversations or private records.

| Guide                                            | Read it to learn                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| [Choosing coordination](comparison.md)           | How Semaphile compares with limiters, messaging tools and embedded stores |
| [Architecture](architecture.md)                  | How a request reaches SQLite or Redis and returns capacity                |
| [Blocking and descriptor ownership](blocking.md) | Where threads wait and how shutdown releases resources                    |
| [Design decisions](design-decisions.md)          | Why the backends use these coordination mechanisms                        |
| [Execution and maintenance](resilience.md)       | Retry safety, HTTP lifetime, recovery and persistent drains               |
| [Observability](observability.md)                | Optional tracing, shared collectors and messaging upgrades                |
| [Testing](testing.md)                            | How to reproduce local, cross-runtime and cross-host checks               |
| [Documentation policy](publication.md)           | What belongs in public guides and private working records                 |
| [Specification](../SPEC.md)                      | The authoritative behavior and versioned engineering decisions            |
| [Contributing](../CONTRIBUTING.md)               | Setup, coding conventions and verification commands                       |

Package references: [SQLite](../packages/core/README.md) and
[Redis](../packages/redis/README.md), plus the
[messaging library and CLI](../packages/messaging/README.md).

See [releases](releases.md) for installing verified archives and the maintainer release process.

[Redis messaging and topics](redis-messaging.md) explains cross-project mailboxes,
durable subscriptions, agent payloads, failure behavior and the SQLite 1.2 upgrade.
