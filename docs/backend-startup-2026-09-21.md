# Backend startup diagnostics and cancellation — 2026-09-21

Status: **implemented and tested locally; not deployed to Nexa**. These changes do not establish a live backend speedup or a sub-second terminal load.

Repository: `Orrnn-RTX5/Broker-Backend-V2`, cloned from `main` at `ea7684b1572e7f3cacde599ac1a1306120b2cead` into `C:/Users/ADMIN/.codex-tmp/rtx-startup-backend-20260921`. The checkout was clean before these changes. Edits remain uncommitted; no push, workflow dispatch, migration, or remote deployment was performed.

## Changes

- `services/gateway/middleware/auth.go` passes the HTTP request context through bearer-token and API-key validation, including Redis and PostgreSQL operations. Already canceled requests stop before backend work, and cancellation during cache work prevents subsequent database work. Current role, revocation, account-status, ownership and investor-session checks remain enforced.
- Canceled or expired request contexts return without writing an authentication failure or falling through to anonymous processing. The existing chi timeout middleware can therefore return **504**, while genuinely invalid credentials still return **401**. A server timeout must not falsely expire a valid user session.
- `services/gateway/internal/servertiming/timing.go` appends fixed `Server-Timing` metrics without account IDs, tokens, hostnames or request parameters. Existing timing/cache headers are preserved.
- `services/gateway/handlers/handlers.go` measures the existing live account-metrics calculation in `GetAccount`; it does not replace that calculation or alter account response fields.
- `services/gateway/handlers/candle_history_client.go` measures configured history-service response-header and body-read phases. Symbol authorization, original OHLC/closed-state fields, the existing request timeout, redirect restrictions and `no-store` behavior remain unchanged. This instrumentation covers the configured dedicated history-service path; it does not instrument the legacy gateway SQL fallback.
- `services/gateway/middleware/cors.go` grants `Timing-Allow-Origin` only to an origin already explicitly allowed by its CORS configuration. Wildcard/disallowed origins do not receive detailed timing access. No new origin was allowed, and no additional response headers were generally exposed through CORS.

| Metric | Measured phase |
| --- | --- |
| `auth` | Bearer-token or API-key validation before downstream processing |
| `account_metrics` | Existing `CalculateAccountMetrics` call |
| `history_upstream` | Dedicated history request through receipt of response headers, including connection/transport wait |
| `history_read` | Reading the dedicated history response body |

These are individual phase durations, not a complete request-duration breakdown. Account ownership/query work, symbol-scope resolution, serialization, external proxies and other uninstrumented work can remain outside them. Timing headers will only describe the live Nexa route after the corresponding runtime artifact is deployed. An external proxy may also apply its own CORS/timing policy.

## Validation

Portable Go **1.27.1**, with `GOMAXPROCS=2` and at most two build workers. The following commands were executed from `C:/Users/ADMIN/.codex-tmp/rtx-startup-backend-20260921/services/gateway`:

```powershell
$go = 'C:\Users\ADMIN\.codex-tmp\rtx-startup-go1.27.1\go\bin\go.exe'
$env:GOMAXPROCS = '2'
& $go test -mod=readonly -p 2 ./internal/servertiming ./middleware ./handlers -run 'Test(Append|StartupAuthentication|AlreadyCanceledAuthentication|AuthTiming|CORS|CandleHistory)' -count=1 -timeout=180s
& $go test -mod=readonly -p 2 ./middleware -run 'TestCORS' -count=1 -timeout=60s
& $go test -mod=readonly -p 2 ./middleware -run 'Test(StartupAuthentication|AlreadyCanceledAuthentication|AuthTiming|CORS)' -count=1 -timeout=60s
```

All passed. Across these runs, the selectors covered **24 unique top-level tests**, with nested cases in addition. The final middleware run followed the cancellation-versus-401 correction. Checks include bearer/API-key cancellation during Redis and database work, optional/required authentication, real chi timeout stacks with signed valid JWTs, invalid-credential 401 responses, cached-user revocation, committed response headers, real HTTP history cancellation, permission boundaries, unchanged candle payloads and cache policy. The broad `TestAppend` selector also ran existing instrument/quote admission tests. Go formatting and `git diff --check` passed.

This is focused unit/HTTP-handler validation. No live database, live Redis, full broker deployment, or authenticated production performance test was run for these backend changes.

## Limits and rollout requirements

The pinned go-redis v9.5.1 client defaults `ContextTimeoutEnabled` to false, and the shared gateway client does not override it. Forwarding the request context fixes detached auth work and allows PostgreSQL cancellation, but an already-started Redis socket read can still finish at the driver's existing I/O timeout. The shared trading Redis client's timeout policy was not changed. Fake-cache tests prove context propagation, not immediate cancellation of every real Redis socket operation.

GitHub read access is available, but the committed backend broker registry contains only the `orrnn` canary. Its build workflow automatically dispatches that broker, and the diagnostics/deploy workflows select from the same registry. **Nexa is not a configured deployment target in this checkout.** The old frontend infrastructure repository reference was unavailable; the current frontend deploy workflow is entirely commented out.

The backend's September 19 Nexa runbook records a gateway running a bind-mounted binary with local modifications and an active `rtx5_local` database. That historical evidence is not current runtime verification, and rebuilding a different Docker image would not necessarily update the mounted binary. No authenticated Nexa host connection or local Docker runtime was found in this workspace. Do not substitute the `orrnn` target or deploy unrelated backend changes to reach Nexa. Identify the actual Nexa host, mounted artifact and baseline revision, then use that deployment's reviewed release/rollback process for this bounded patch.

The portable patch was recorded as `artifacts/web-startup-profile-20260921/backend-startup-latency.patch` (a historical artifact that is not stored in this repository). It includes the new timing helper and tests as well as modifications to existing files, relative to the backend baseline above. It is a reviewable source change, not a deployed artifact.
