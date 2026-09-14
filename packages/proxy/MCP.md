# MCP stdio proxy

`@semaphile/proxy/mcp` adds shared tool-call admission to an existing MCP stdio
server. Each agent launches a proxy around its server; SQLite or Redis coordinates
the request budget across those proxy processes. The proxy does not merge server
sessions or translate their capabilities.

This feature is introduced in the **0.4.0 source checkpoint**, using matching
Semaphile packages. npm remains on the published version documented in the
[release guide](../../docs/releases.md).

## CLI configuration

```sh
semaphile-mcp-proxy --config ./mcp-proxy.json
# With matching @semaphile/messaging installed:
semaphile proxy mcp --config ./mcp-proxy.json
```

```json
{
  "version": 1,
  "command": "bun",
  "args": ["./server.ts"],
  "cwd": "./servers",
  "env": { "NOTION_TOKEN": "NOTION_TOKEN" },
  "pool": {
    "backend": "sqlite",
    "path": "./state/notion",
    "config": { "maxConcurrent": 3, "minTime": 350 }
  }
}
```

The executable must speak MCP on stdin/stdout. Configure your MCP host to launch
`semaphile-mcp-proxy` with `--config` and the config file's absolute path. Relative
pool paths and `cwd` resolve against that file; absent `cwd` uses its directory.
No config discovery or shell expansion takes place. Arguments are an array.

`env` maps **child variable names to variable names in the proxy environment**.
Values are read at startup. The child receives the SDK's small default environment
allowlist plus these explicit values; it does not inherit all proxy credentials.
`stderr` defaults to `"ignore"`; `"inherit"` explicitly enables the child server's
diagnostics. Proxy errors never include raw payloads, credentials or connection
error excerpts. Standard output contains only MCP protocol frames.

The pool selector also supports memory or Redis:

```json
{ "backend": "memory", "key": "local-tools", "config": { "maxConcurrent": 3 } }
```

```json
{
  "backend": "redis",
  "urlEnv": "REDIS_URL",
  "namespace": "team",
  "pool": "notion",
  "config": { "maxConcurrent": 3 }
}
```

Memory shares a budget only within one runtime. SQLite and Redis share it across
processes; Redis requires matching `@semaphile/redis`. Full persisted configuration
must match, including defaults. Use another pool identity for a different policy.

## Library

```ts
import { openLimiter } from '@semaphile/core';
import { startMcpProxy } from '@semaphile/proxy/mcp';

const limiter = await openLimiter({
  path: './state/tools',
  config: { maxConcurrent: 3 },
});
const proxy = await startMcpProxy({
  limiter,
  command: 'bun',
  args: ['./server.ts'],
  env: { NOTION_TOKEN: process.env.NOTION_TOKEN! },
});
await proxy.finished;
await limiter.close();
```

Library `env` contains literal values. `input` and `output` default to the current
process's stdin and stdout; custom Node-compatible streams are supported. The
library borrows these streams and the limiter. Closing pauses input and detaches
listeners without destroying caller streams. Already submitted output writes may
finish later; the caller owns those streams' final disposal. The CLI owns and
closes its standard streams after bounded shutdown.

`proxy.close({ drain: true })` finishes accepted requests within their existing
deadlines, then terminates the child. Default close cancels queued work and
terminates the child. The first close call chooses drain behavior. EOF, malformed
frames, transport failure or an unresponsive cancelled request terminates the
session. `finished` resolves after cleanup; `inspect().error` reports a bounded
failure code when termination was caused by a failure.

## Admission and protocol behavior

Only downstream `tools/call` requests acquire capacity. Initialization, modern
server discovery, tool listings, other protocol requests, notifications and
responses to server callbacks bypass that queue. This keeps cancellation and
server callbacks usable while tools occupy all capacity. Control requests have
their own bound and deadline.

The proxy preserves request IDs, protocol envelopes, metadata, results, errors and
notifications. Client and server request IDs have separate directions. A duplicate
live downstream ID terminates the session because replying with that same ID
would make the original request ambiguous. The implementation uses the official
[TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/) for wire framing;
conformance exercises both legacy negotiation and the `2026-07-28` protocol with
real SDK clients and servers.

Queued cancellation never sends the tool call upstream. Running cancellation is
forwarded; its lease stays held until a terminal response or the owned child
exits. A child that ignores cancellation is terminated after the cancellation
grace, with SIGKILL escalation after the shutdown grace. This ends all outstanding
requests on that server. Sending a signal alone never releases its running leases.
Lease expiration retains core semantics and can allow replacement work sooner.
Child exit cannot prove that remote side effects or detached descendants stopped.

There is no automatic tool retry and no extraction of HTTP hints from arbitrary
MCP error payloads. Tool errors remain protocol results. Local refusals use
JSON-RPC error code `-32000` with a stable message such as `MCP_QUEUE_FULL`,
`MCP_REQUEST_TIMEOUT`, `MCP_REQUEST_CANCELLED` or `MCP_UNAVAILABLE`.

## Bounds

All timeout values are positive integer milliseconds. Defaults are:

| Option                | Default | Scope                                                |
| --------------------- | ------: | ---------------------------------------------------- |
| `maxPending`          |     256 | Queued and running tool calls                        |
| `maxControlPending`   |      64 | Outstanding downstream control requests              |
| `maxMessageBytes`     |   1 MiB | Unparsed input buffer and serialized output frame    |
| `maxBufferedBytes`    |   8 MiB | Retained request frames, and each output writer      |
| `queueTimeoutMs`      |  30,000 | Waiting for tool admission                           |
| `requestTimeoutMs`    | 300,000 | Entire request, including queue time                 |
| `cancellationGraceMs` |   2,000 | Waiting for a running cancellation response          |
| `shutdownGraceMs`     |   2,000 | SIGTERM-to-SIGKILL escalation and output flush grace |

Optional `toolWeights` maps tool names to positive integer weights. Unlisted tools
cost one unit. The pool's concurrency/reservoir rules apply to those weights.
Control traffic does not consume tool budget, and the input reader does not wait
for tool completion before handling later protocol messages.

This first MCP adapter supports stdio-to-stdio. HTTP MCP protocol translation,
OAuth brokering and combining multiple upstream servers are deferred. The HTTP
proxy can front a fixed HTTP endpoint at HTTP-request granularity, which has a
different admission lifetime from this tool-call adapter. Direct Semaphile clients
continue to coordinate through a daemonless file without either proxy.
