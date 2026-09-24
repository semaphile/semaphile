# SEM-2 baseline

Historical records pinned at `d585cf9b8ff5ad521673d4ffd56af6705242aadb`. Candidate source is
`800c8c53b8548250da6bf4a684bf796f1e9e1a73`. These are historical facts, not new test results.

| Archive | SHA-256 |
| --- | --- |
| semaphile-core-0.3.0.tgz | `6f944338dbe1d5ce01170902d453e73d474a54e0f43f366b8ca1a303598f89eb` |
| semaphile-redis-0.3.0.tgz | `bfdc9c5a678c90e6947674e0b1d5542cb8fcebc8fc7f0c7a68b789d555fcb640` |
| semaphile-messaging-0.3.0.tgz | `35d3a0e0bc262923a9ca2155e317eb8726efbb763a55609fb3473161a63808aa` |
| semaphile-otel-0.3.0.tgz | `19a33a67d66abcc68bb0be3fce93e3f3dae86a5620fc80e3c882331e630dc3e4` |

Retained archive location relative to the primary checkout:
`releases/candidates/redis-messaging/0.3.0/800c8c53b8548250da6bf4a684bf796f1e9e1a73/`.
All four files existed and matched the retained SHA256SUMS during planner
inspection on September 24. Verify again at execution; absence blocks tests.

Historical runtime line: macOS arm64 Node 22.21.1; Linux x64 Node 22.23.0;
Bun 1.4.2 and Redis 8.4.0 on both. Linux archived native target requires glibc.

The checkout profile can omit the locked SEM-2 folder. Read the authoritative
historical record without changing that profile:

```sh
git show d585cf9b8ff5ad521673d4ffd56af6705242aadb:goals/SEM-2-redis-messaging-release/results/GATES.md
git show d585cf9b8ff5ad521673d4ffd56af6705242aadb:goals/SEM-2-redis-messaging-release/results/ARTIFACTS.json
```

The complete deferred criteria are copied verbatim in `sem2-debt.md`. Absolute
personal paths from ARTIFACTS.json are intentionally not copied into this reference.
