# Execution, HTTP and maintenance

SQLite, Redis and memory expose the same execution and maintenance API. Pick
storage by the scope of coordination: one machine, multiple machines, or one
JavaScript runtime. All clients must agree on the full normalized pool config.

## Choose an execution boundary

Use `schedule(callback)` for one callback with no automatic retries or execution
deadline. Use `execute(callback, options)` when Semaphile should manage attempts,
cancellation and deadlines. Use `http.request` to keep capacity through response
processing, or `http.fetch` to return headers while retaining capacity until the
response body finishes or its cancellation completes.

```ts
const limiter = await openLimiter({
  path: './.semaphile/pools/service', // Redis: url + pool; memory: key
  config: {
    maxConcurrent: 5,
    minTime: 100,
    recovery: {
      retry: { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 10_000 },
      deadlineMs: 300_000,
      attemptTimeoutMs: 60_000,
      breaker: { failureThreshold: 5 },
    },
  },
});

try {
  const result = await limiter.http.request(
    'https://service.example/search?q=coordination',
    async (response) => {
      if (!response.ok) throw new Error(`Service returned ${response.status}`);
      return response.json();
    },
    { retrySafety: 'safe', queueTimeoutMs: 10_000 },
  );
} finally {
  await limiter.close({ drain: true });
}
```

`retrySafety` defaults to `'unsafe'`. Mark an operation safe only when replaying
it cannot duplicate unwanted effects, for example a read or a provider-supported
idempotent write. Transient classification is also required. Configuring retries
alone never opts a callback into replay.

The defaults are three total attempts, 500 ms exponential delay with factor 2,
a 10-second cap and bounded ±20% jitter, a five-minute overall deadline and a
60-second attempt timeout. `policy` on an individual operation can override retry
settings and deadlines; `null` disables either execution deadline. Shared
concurrency, spacing, budgets and breaker rules cannot be overridden per call.

Each attempt obtains a new lease and spends its weight from the budget. Retry
delays hold no concurrency lease. `queueTimeoutMs` applies to each admission,
including initial operation acceptance. Attempt context contains `operationId`,
a one-based `attempt`, frozen `admission`, and a fresh `signal` to pass to the SDK.

A timeout or cancellation rejects the public result promptly and signals the
callback. It does not force arbitrary JavaScript or an SDK request to stop.
These events end automatic retry for that execution. Capacity and operation
accounting remain until actual callback cleanup, subject to explicit lease expiry.
Consequently, `close()` can still wait after the public result has rejected.

## Classify SDK outcomes

A classifier receives `{ status: 'fulfilled', value }` or
`{ status: 'rejected', error }`. It returns a `kind`: `success`, `neutral`,
`throttle`, or `service-failure`, optionally with `retryAfterMs` and `retry`.
`retry: false` reports the shared outcome while preventing replay.

```ts
const value = await limiter.execute(({ signal }) => sdk.read({ signal }), {
  retrySafety: 'safe',
  policy: { classifierId: 'example-sdk/read-v1' },
  classifier: {
    id: 'example-sdk/read-v1',
    classify(result) {
      if (result.status === 'fulfilled') return { kind: 'success' };
      if (isProviderThrottle(result.error)) return { kind: 'throttle' };
      if (isProviderUnavailable(result.error)) return { kind: 'service-failure' };
      return { kind: 'neutral' };
    },
  },
});
```

The classifier ID must match the effective policy. Changing classifier semantics
requires changing that ID. IDs and configuration fingerprints cannot verify that
separate clients actually supplied identical callback code. Unclassified work is
neutral; application bugs should not become evidence of a service outage.

## HTTP lifetime and replay

HTTP helpers classify 429 as throttling, 500/502/503/504 and recognized transport
errors as service failures. Other successful responses are success; other status
codes are neutral. They accept the default generic policy or the built-in
`semaphile.http/1` classifier policy. Provider guidance accepts decimal seconds
and validated HTTP dates as defined by [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after).
A known response's guidance survives subsequent body failure.

`options.request` holds Fetch `RequestInit` fields. Top-level `signal`, the input
Request signal and `request.signal` all cancel the operation. Safe replay copies
supported static bodies before queueing. A streaming body or a Request with a
body requires `bodyFactory(attempt)` to produce a fresh body for each attempt.
A response is never automatically replayed after reaching application code.

```ts
const response = await limiter.http.fetch(url, {
  retrySafety: 'safe',
  request: { headers: { accept: 'application/json' } },
});
try {
  await consumeStream(response.body);
} finally {
  if (!response.bodyUsed) await response.body?.cancel();
}
```

Consume or cancel returned bodies. If holding a reader, cancel that reader when
stopping early. The helper does not eagerly buffer bodies. Empty EOF and unread
body failure release capacity; an unfinished unread body retains it until
cancellation or a configured deadline. Scoped `http.request` cancels any unread
body after its handler settles and awaits that cleanup. Cancelling an unfinished
successful probe body cannot establish recovery.

## Shared recovery

Throttling and service failures establish a shared cooldown observed by peers.
`Retry-After` is a minimum even beyond the exponential cap. A breaker is disabled
by default; `recovery.breaker: {}` enables the consecutive rule with five service
failures. The percentage rule requires `rule: 'percentage'`, `failureRatio`,
`minimumSamples` and `windowMs`. Recovery pauses default to 30 seconds doubling to
five minutes. One valid probe may run at a time, using the normal request budget.
Lost, cancelled or expired probes cannot close the breaker. Throttling does not
count as a service failure.

Open circuits queue by default. Use `circuit: 'fail-fast'` to reject with
`CircuitOpenError`. Stale completions cannot reset newer recovery generations.
These mechanisms do not discover provider credits or adapt the concurrency cap.
For a hosted service with no official request rate, choose `maxConcurrent` from
measured capacity and use the breaker to avoid repeatedly overloading it.

## Persistent maintenance

`close({ drain: true })` finishes one client's accepted work. Pool maintenance
establishes a shared acceptance boundary and persists until explicitly resumed.

```ts
const receipt = await limiter.maintenance.drain();
const generation = receipt.maintenance.generation;
const status = await limiter.maintenance.wait({ generation, timeoutMs: 30_000 });
if (status.maintenance.clean) {
  // Every accepted operation has confirmed completion.
}
await limiter.maintenance.resume(generation);
```

New work fails with `PoolDrainingError`; previously accepted retries may finish.
`status()` and `wait()` return a full snapshot including recovery state, operation
uncertainty and configuration fingerprint. Mutating commands return bounded
receipts. A timeout (`DrainTimeoutError`) cancels only the wait and leaves the
pool draining. Signals and client close also cancel waits without resuming.

Owner death or expiry cannot prove remote completion. Lost unfinished operations
remain in `unconfirmed`. After investigating, an operator may call
`acknowledge({ generation, ids, reason })`. Acknowledgement can make a drain
`settled` while it remains `clean: false`; it never fabricates completion. Stale
generations cannot acknowledge or resume a newer drain. Memory maintenance only
coordinates callers within that runtime. See the [CLI](../packages/messaging/README.md)
for external SQLite and Redis administration.

## Switching experimental formats

Current limiter formats are SQLite `semaphile-sqlite-poc/1.4` and Redis state `2`.
Messaging remains `semaphile-messaging/1.0`. No automatic migration is provided.
Stop producers, drain where supported, close all clients, then use a new pool
identity or back up the entire closed SQLite directory before replacement.
Fresh storage does not imply fresh provider credits: initialize its budget from
the provider's actual remaining allowance. Never replace live coordination files.
