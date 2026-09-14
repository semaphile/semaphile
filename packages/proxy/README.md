# @semaphile/proxy

An HTTP reverse proxy that lets agents share Semaphile request budgets without
changing their HTTP client. Point each client's base URL at a named route. The
operator selects each upstream and its memory, SQLite, or Redis limiter.

This package is introduced in the **0.3.0 source checkpoint**. Use matching
Semaphile package versions; see [release status](../../docs/releases.md) for
published versions and native platform support.

```ts
import { openLimiter } from '@semaphile/core';
import { startHttpProxy } from '@semaphile/proxy';

const limiter = await openLimiter({
  path: './state/notion',
  config: { maxConcurrent: 5, minTime: 350 },
});
const proxy = await startHttpProxy({
  port: 9470,
  routes: [
    {
      name: 'notion',
      upstream: 'https://api.notion.com',
      limiter,
      headers: { Authorization: `Bearer ${process.env.NOTION_TOKEN}` },
    },
  ],
});
// POST http://127.0.0.1:9470/notion/v1/search → https://api.notion.com/v1/search
// On shutdown:
await proxy.close({ drain: true });
await limiter.close();
```

The library borrows limiter clients. It holds admission through upload, response
streaming and I/O cleanup. Closing the proxy leaves borrowed clients usable.
Lease expiration retains the core's existing semantics: an expired lease may
allow replacement work even if a remote operation has not stopped.

## Command line

The standalone binary accepts an explicit JSON configuration file:

```sh
semaphile-http-proxy --config ./proxy.json --drain
# With @semaphile/messaging and this package installed:
semaphile proxy http --config ./proxy.json --drain
```

```json
{
  "version": 1,
  "port": 9470,
  "maxPending": 1024,
  "routes": [
    {
      "name": "notion",
      "upstream": "https://api.notion.com",
      "headersEnv": { "Authorization": "NOTION_TOKEN" },
      "queueTimeoutMs": 30000,
      "requestTimeoutMs": 300000,
      "pool": {
        "backend": "sqlite",
        "path": "./state/notion",
        "config": { "maxConcurrent": 5, "minTime": 350 }
      }
    }
  ]
}
```

Paths resolve relative to the config file. No automatic config discovery occurs.
The CLI opens and closes its own clients. The first SIGINT/SIGTERM starts shutdown;
`--drain` finishes accepted work within its existing deadlines. Without it, queued
and running proxy requests are cancelled and their cleanup is awaited.
Startup prints one JSON record with `listening` and `routes`. Tokens, headers,
payloads and underlying connection errors are not printed.

A memory selector uses `{"backend":"memory","key":"notion","config":{...}}`;
it shares capacity only within one runtime. A Redis selector uses
`{"backend":"redis","urlEnv":"REDIS_URL","namespace":"team","pool":"notion","config":{...}}`
and requires the matching `@semaphile/redis` package. Optional `ownerTimeoutMs`
sets Redis owner expiry. SQLite and Redis pools must match their full persisted
configuration; drift fails startup. A named route is not a new pool identity.

## Forwarding and admission

- The first path component chooses a fixed upstream; the remaining raw path and
  query append to its base path. Upstream URLs cannot contain credentials, a
  query or a fragment. Redirect responses are returned without following them.
- Bodies stream with backpressure. Compressed wire bytes, status codes and
  duplicate cookies are preserved. Hop-by-hop headers and headers named by
  `Connection` are removed. Forwarding identity and proxy authentication headers
  are not passed upstream. Operator headers override incoming headers.
- Each request makes at most one upstream attempt. HTTP 429 and transient server
  failures update Semaphile's shared cooldown/breaker using its built-in HTTP
  classifier, including valid `Retry-After`. The proxy never replays a body.
- `weight` defaults to 1; `queueTimeoutMs` to 30 seconds and total
  `requestTimeoutMs` to 5 minutes. Both timeouts must be positive finite integer
  milliseconds. `maxPending` counts queued and running requests per listener;
  excess requests get 503. `maxConnections` defaults to 2048.
- Local errors are JSON `{ "error": "CODE" }`. Queue/deadline timeouts return
  504, upstream transport failures 502, closing/overflow 503. After response
  headers have started, errors close the stream instead of appending JSON.

## Listener boundaries

The default listener is `127.0.0.1:9470`. Browser `Origin`/`Sec-Fetch-Site` requests
and unexpected `Host` authorities are rejected before admission. Non-loopback
bindings require `token` (CLI: `tokenEnv`) and `allowedHosts`, an array of full
host:port authorities. Clients send the separate `X-Semaphile-Token` header.
Place remote listeners behind operator-managed TLS; the library does not terminate
TLS. Tokens must contain 16–4096 characters. Upstream HTTPS verifies certificates
using the runtime defaults.

This is a reverse proxy for configured APIs. CONNECT, WebSocket upgrades,
TLS interception and automatic retries are outside its contract. The operator
starts the listener explicitly; direct Semaphile use still needs no daemon.

For MCP tool-call admission, see the [MCP stdio proxy guide](MCP.md), introduced in the 0.4.0 source checkpoint.
