# Blocking and descriptor ownership

SQLite coordination uses OS locks and event subscriptions. Redis coordination
uses socket events and computed timers. Neither backend polls periodically
for capacity.

## SQLite mechanisms

| Purpose                   | macOS                                  | Linux                        |
| ------------------------- | -------------------------------------- | ---------------------------- |
| Serialize database access | `flock(LOCK_EX)` on the pool gate      | Same                         |
| Prove owner lifetime      | Unique owner-file `flock`              | Same                         |
| Detect file notifications | `kqueue` vnode events                  | `inotify` through `epoll`    |
| Observe process exit      | `kqueue` `NOTE_EXIT`                   | `pidfd_open` through `epoll` |
| Cancel event waiting      | Private pipe watched by the event loop | Same                         |

The coordinator worker owns a `Pool` and a Rust native context. Rust owns gate,
notification and lifetime descriptors, each separately opened and close-on-exec.
JavaScript uses opaque objects. SQLite does not open the companion lock files.

A process-exit event is a hint. Reclaim requires checking the owner's unique
lifetime lock under the gate; a PID alone never authorizes reclaim. Expired
leases are independently reclaimable even when the owner is alive. Owner
identities and their files are never reused to impersonate an old generation.

The coordinator runs the blocking gate acquisition outside the application
thread. Each active subscription has a dedicated Rust thread blocked on
file/process/cancellation events. Close signals cancellation and joins that
thread before destroying resources. The Node-API environment cleanup hook follows
the same order, retires owner locks and notifies peers. Native waits do not use
the shared libuv worker pool. Normal shutdown awaits these waits before retiring
the JavaScript coordinator.

A live, suspended gate holder can stall all coordination for that pool. Moving
the wait off the application thread does not make `flock` forcibly cancellable.
Queued cancellation can settle promptly while final cleanup still waits for
the gate. Never run callbacks while holding it.

## Redis waits

Subscribe before opening/checking pool state. Record the notification version
before an admission attempt. If a notification arrives during that attempt,
retry the authoritative check rather than sleeping after a missed hint.
Otherwise wait for a publication or a computed owner, request, spacing or refill
deadline. Ownership renewals and subscription health checks are scheduled from
the owner's timeout and do not poll admission state.

Terminal cleanup aborts sockets even if they are still resolving DNS or
connecting. A failed client cannot reconnect itself or replay an uncertain
mutation. Running callbacks are still awaited before client shutdown completes.

## Messaging ownership

Messaging reuses the native primitives in independent stores. Durable mailbox
names map to hashed inbox notification paths. Each wait owns its subscription
and cancellation pipe; descriptors close only after the native wait returns.
Registration locks live on the coordinator worker and close under the gate,
including attempts to retire every registration when one cleanup step fails.

A claim belongs to a receipt rather than a process. Its computed expiry wakes
receivers even when the claimant is alive. Listener renewal has a separate
known-expiry watchdog so a blocked renewal cannot suppress handler cancellation.
User callbacks and adapter commands never execute under the gate. A synchronous
callback that blocks its entire JavaScript event loop cannot be forcibly
cancelled by an AbortSignal.
