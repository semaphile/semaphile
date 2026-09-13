# @semaphile/messaging

Durable messaging between local processes, with SQLite and kernel notifications.
TypeScript library and `semaphile message` CLI; no resident daemon or periodic
inbox polling. Supports Node 22.18+ and the modern Bun version verified by the
conformance suite. Native artifacts currently target macOS arm64 and Linux x64.

This package is experimental. See the [release guide](../../docs/releases.md)
for installation and verified GitHub archives. Installation does not compile native code.

## Library

```ts
import { openMessaging } from '@semaphile/messaging';

const client = await openMessaging({
  path: './.semaphile/messaging',
  configMismatch: 'error', // Default is 'warn', adopting persisted settings.
});
await client.createMailbox('reviewer');
await client.send({
  to: 'reviewer',
  body: JSON.stringify({ instruction: 'Review the change' }),
  dedupeKey: 'review-request-123',
});

const delivery = await client.wait('reviewer', { timeoutMs: 5_000 });
if (delivery) {
  // Durably accept delivery.id and its payload in your adapter before acking.
  console.log(delivery.message.body);
  // Call client.ack(delivery.receipt) after that durable acceptance succeeds.
}
await client.close(); // The outstanding receipt survives this process exiting.
```

For automatic handling, your adapter supplies a function whose successful return
means durable acceptance:

```ts
const listenerClient = await openMessaging({ path: './.semaphile/messaging' });
const listener = listenerClient.listen('reviewer', async (delivery, context) => {
  await durableAccept(delivery.id, delivery.message.body, context.signal);
});
await listener.close(); // Stop new claims; finish active handlers.
await listenerClient.close();
```

`durableAccept` above is your application function. Printing a message, launching
a process, or typing into a terminal is not itself proof of durable acceptance.
Task completion can be a later reply with `correlationId` or `replyTo`.

A `receive()` returns an array immediately; `wait()` blocks until one delivery,
cancellation, or its optional timeout. Positive timeouts include time queued for
the store gate; zero performs one inspection and never waits for a message. Both default to manual acknowledgment.
Each returns a receipt with **deliveryId and claimId**. A new attempt preserves
the delivery ID but gets a new claim ID. `ack`, `release`, and `renew` reject stale
ownership through `{ status: 'stale' }`; duplicate retained acknowledgments are
idempotent. Renewal of a retained, successfully acknowledged receipt reports
`acked` without changing it, allowing listener cleanup to continue after another
process accepts the delivery. History eviction eventually removes old acknowledgment receipts.

Listeners default to `handler-success`; select `ackMode: 'manual'` for explicit
`context.ack()` or acknowledgment from another process. A sender's optional
`ackMode` must appear in the receiver's `acceptedAckModes`, which defaults to
its configured mode. Incompatibility fails that delivery without invoking the
handler. Accepting both modes means your handler must honor `delivery.ackMode`.

Listeners renew active claims, bounded by `maxHandlingMs` and message expiry.
An independent deadline watchdog signals `context.signal` even if renewal is
blocked on the store gate. Cancellation is cooperative: a callback or remote
request may continue after claim loss. `close({ cancel: true })` signals active
handlers and may escalate an earlier graceful close. Neither close mode drains
the durable queue; both await active handler cleanup. A noncooperative callback
or suspended gate holder can therefore delay shutdown.

Handler failures and abandoned claims consume the same attempt budget. After
exhaustion, inspect `history()` and explicitly `retry(deliveryId)`. Release also
uses the retry policy. Failed or expired deliveries are visible while history
is retained; expired messages require a new send.

## CLI and configuration

```sh
semaphile init
semaphile message create --name reviewer
semaphile message send --to reviewer --body 'Review the change'
semaphile message wait --as reviewer --timeout 5000 > receipt.json
# Once the adapter has durably accepted the message:
semaphile message ack --receipt-file receipt.json
semaphile info
```

`semaphile.json` defines project defaults:

```json
{
  "version": 1,
  "directory": "./.semaphile",
  "pools": {},
  "messaging": {
    "config": { "maxAttempts": 5 },
    "clientDefaults": { "configMismatch": "warn" },
    "listenerDefaults": { "concurrency": 1, "maxHandlingMs": 3600000 },
    "handler": ["node", "./adapter.mjs"]
  }
}
```

The CLI searches from its working directory upward and uses the nearest config.
Invalid nearer files are errors. Relative paths resolve against that file.
`--store PATH` bypasses discovery and selects one individual messaging store;
`--config-mismatch error` overrides the client's default warning policy.
Library `loadConfig()` and `messagingOptions()` expose discovery explicitly;
`openMessaging()` itself uses only the supplied path and options.

Shared configuration is fixed at creation. Warning mode reports differences and
uses persisted values; error mode rejects before registration or logical mutation.
`client.config` exposes effective settings; `onWarning(differences)` receives
structured differences. Editing JSON never silently reconfigures a store.
`init` creates missing stores, validates existing ones strictly, and can resume
partial initialization. It does not overwrite an existing config file.

A common root holds `messaging/` and independent `pools/<name>/` databases.
Initializing named pools requires the optional `@semaphile/core` package; pool
configuration mismatches always fail. `info` shows complete persisted settings
and normalized project comparisons. With an explicit store and no expected
configuration, it explicitly reports that no comparison was requested. Library
`info({ store, expectedConfig })` performs that comparison without registering.

```sh
semaphile message listen --as reviewer -- node ./adapter.mjs
semaphile message register --name reviewer -- node ./agent.mjs
semaphile message agents
semaphile message send --to '*' --body 'Status check'
```

Handlers receive one JSON delivery envelope on stdin. They must consume the
input and exit zero only after durable acceptance. Input-write errors and
unsuccessful exits fail the attempt. SIGINT/SIGTERM cancels active CLI handlers; registration wrappers use the same
five-second escalation for an owned child that ignores SIGTERM. Commands run without implicit shell
interpolation. Handler output is inherited. Cancellation sends SIGTERM to the
owned child, then SIGKILL after five seconds if it has not closed; this does not
promise to terminate descendants or undo an external action.

Registration is optional presence. The registering command remains alive, or
wraps the supplied child, holding its own lifetime lock. A listener does not
implicitly register. Broadcast atomically targets the names observed online at
send time; new names never join a deduplicated broadcast retry. Replacing a
session with the same name inherits its mailbox's pending deliveries.

Other commands: `receive`, `renew`, `release`, `retry`, `history`, `events`, and
`append`. Run `semaphile --help` for argument names. History supports recipient,
sender, correlation, topic, time and sequence filters. Events support sequence,
limit, topic and time filters; unsupported filters fail explicitly.
Exit codes: 0 success, 2 wait timeout, 3 cancellation, 4 store/config failure,
5 input or protocol refusal. Claimed message JSON includes the receipt, so a
subsequent command can acknowledge it after the waiter exits.

## Shared defaults and bounds

| Setting                |     Default |
| ---------------------- | ----------: |
| claimTtlMs             |     300,000 |
| maxHandlingMs          |   3,600,000 |
| maxAttempts            |           5 |
| retryDelayMs           |       1,000 |
| retainHistoryMs        | 604,800,000 |
| dedupeRetentionMs      | 604,800,000 |
| maxBodyBytes           |   1,048,576 |
| maxPendingPerRecipient |       1,000 |
| maxMessages            |      10,000 |
| maxEvents              |     100,000 |
| maxContentBytes        | 134,217,728 |

Retry delays double after each unsuccessful attempt. Terminal history may be
evicted earlier than its age limit under storage pressure. Pending bodies are
protected; deduplication survives until the configured period after the entire
message becomes terminal, even if history bodies were evicted. When protected
data fills capacity, new sends fail. Bounded cleanup yields the gate between
batches and repeats only after actual cleanup progress.

Logical accounting includes payloads, envelope/dedupe metadata, session metadata,
mailboxes and events, with conservative row overhead. Each pending delivery
reserves 8 KiB for its future claim/error state so acknowledgment and failure
recording do not require additional capacity. Terminal transitions return unused
reservation. This is not a physical filesystem quota. Stable owner and inbox
coordination files are retained. Historical row cleanup is opportunistic; reads
hide history past its age window without requiring a background cleanup process.

Use local filesystems and cooperative processes. Kernel lifetime locks indicate
process participation, not whether an agent is ready to handle a task. Claims
expire independently of presence. At-least-once delivery permits duplicate
external effects, so adapters should deduplicate using the stable delivery ID.
Clock adjustments, reboot handling, power-loss durability and network filesystems
are outside the currently verified contract. Redis messaging and topic
subscriptions are deferred; the existing Redis limiter is separate.

## Development

From the repository root, install dependencies with `--ignore-scripts`, build the
core first, then messaging. Run `node conformance/run.mjs messaging` and repeat
with the supported Bun executable. The core provides private native and pure
policy build inputs; installed messaging artifacts are self-contained.

## Pool administration

The CLI can administer existing limiter pools as well as messaging stores.
Install the matching optional `@semaphile/core` peer for SQLite, and additionally
`@semaphile/redis` for Redis. Memory pools have no external CLI: their state lives
inside one JavaScript runtime.

```sh
semaphile pool status --name service
semaphile pool drain --store ./.semaphile/pools/service
semaphile pool wait --store ./.semaphile/pools/service --generation 1 --timeout 30000
semaphile pool resume --store ./.semaphile/pools/service --generation 1
```

`--name` selects a pool from the nearest `semaphile.json`; its full configuration
must match the existing store. `--store` selects an existing SQLite directory and
reads persisted policy. Add `--pool-config policy.json` to enforce explicit
expectations. Named configuration cannot be combined with `--pool-config`.
Empty selectors reject. These commands do not initialize missing pools.

For Redis, provide the URL through an environment variable and put the expected
limiter configuration in a JSON file. Match the existing ownership timeout too:

```sh
semaphile pool status --redis-url-env REDIS_URL --pool service \
  --namespace team --pool-config policy.json --owner-timeout 30000
```

Use the same selectors with `drain`, `wait`, `acknowledge` and `resume`. Redis
administration atomically refuses missing state. Keep credentials in the named
environment variable; policy files contain limiter settings, not the Redis URL.

Drain returns its generation. Supply that generation to subsequent commands;
a stale generation cannot alter a newer drain. If a status snapshot contains
unconfirmed operations, investigate their remote effects before acknowledging:

```sh
semaphile pool acknowledge --name service --generation 1 \
  --ids-file reviewed-operation-ids.json --reason 'Operator reviewed provider state'
```

The ID file is a nonempty JSON string array; the reason must be nonblank and at
most 4096 characters. Acknowledgement can make a drain settled, but cannot make
uncertain work clean. A timed-out or cancelled wait never resumes the pool.
Successful commands print JSON. Exit 2 means timeout, 3 means cancellation after
opening, 4 means store/configuration failure and 5 means input/protocol refusal.
During startup, SIGINT/SIGTERM retain normal OS termination behavior so a blocked
native gate wait cannot swallow shutdown. After opening, signals cancel waits
and close the administrative client. No command kills producer processes.

See [execution and maintenance](../../docs/resilience.md) for the library API,
recovery behavior and experimental-format replacement procedure.
