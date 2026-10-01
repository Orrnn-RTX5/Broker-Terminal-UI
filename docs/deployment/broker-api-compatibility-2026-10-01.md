# Broker API compatibility verification — 2026-10-01

This verification used public, read-only requests. No account login, password submission, order, position mutation, deployment, or other repository change was performed.

## Confirmed frontend contract corrections

The public terminal previously required `GET /api/v1/market/symbols`. That route belongs to the MT5 bridge. It is not the gateway's broker-scoped instruments resource and is not available in every gateway deployment.

The default `PUBLIC_MARKET_API=gateway-v2` now reads:

- `GET /api/v2/instruments` for the permitted instrument definitions.
- `GET /api/v2/quotes` for available quote snapshots.
- `GET /api/v2/candles/{symbol}?timeframe=...` for candle history.

The instruments and quotes arrays are joined by the exact broker symbol. Quotes cannot add instruments absent from the instrument catalog. Contract metadata and original source timestamps are preserved; unavailable timestamps, quotes, timeframes, and financial values are not fabricated. Public requests omit credentials and send `X-Broker-ID` as a consistency assertion.

`PUBLIC_MARKET_API=mt5-bridge-v1` explicitly retains the documented `/api/v1/market/symbols` contract for a deployment that supports it. `PUBLIC_CANDLE_BRIDGE=true` separately enables its legacy `/api/v1/candles` compatibility path. Neither option depends on broker names or domains. A 404 does not trigger an endpoint search or a request to another broker.

Unused legacy Market Watch quick-order helpers called `/api/orders/market` with the fabricated default account `RTX-000001`. They now use the existing broker order lifecycle and a bound account login. The legacy symbol-subscribe helper now uses the supported v2 watchlist client. These paths were verified with mocks, not live trades.

## Source contract evidence

The backend source was read from the existing checkout `C:/Users/ADMIN/.codex-tmp/rtx-startup-backend-20260921`, whose HEAD is `ea7684b1572e7f3cacde599ac1a1306120b2cead`. That checkout contains earlier local changes, so its HEAD alone does not identify all inspected source content. It was not modified for this verification.

- `services/gateway/main.go` registers instruments, quotes, and candles in the `OptionalAuth` / `RequireGuestMarketBrokerScope` group.
- `services/gateway/handlers/symbol_scope.go` binds anonymous access to the gateway's server-side `BROKER_ID`. It requires an active broker, enabled feed configuration, and an explicit broker-owned symbol scope. The optional `X-Broker-ID` header can reject a mismatch; it cannot choose the tenant or authorize access.
- `services/gateway/handlers/handlers.go` returns the instrument list as an array, optionally an `instruments` wrapper when revision metadata is requested.
- `services/gateway/handlers/market_ext.go` returns an array of broker-scoped, validated quote records.
- `docs/BROKER_SERVER_SETUP_CHECKLIST.md` maps `/api/v2/` to gateway port 8090 and `/api/v1/market/` to bridge port 8094. These protocol paths and container ports remain legitimate constants.
- The inspected CORS middleware already permits `X-Broker-ID`. Other deployed versions must permit that header and the terminal's actual origin without loosening authentication or TLS.

The live responses below establish endpoint behavior and returned public metadata. They do not establish that the complete inspected source revision, including its earlier local edits, is the deployed artifact. No deployment-panel implementation, registration logs, or database contents were inspected directly.

## Public registry and configuration fields

The inspected handlers and fresh public Achiever responses provide the following contracts:

| Resource | Public fields present | Relevant fields absent |
|---|---|---|
| `/api/v2/broker/servers` | `id`, `broker_id`, `broker_name`, `server`, `protocol`, `region`, `enabled`, `created_at` | Public API origin, WebSocket/feed origin, feed status URL, terminal URL, branding, `server_ip`, `server_port` |
| `/api/v2/brokers/{broker_id}` | `broker_id`, `name`, `status`, `logo_url`, `valid_from`, `valid_until`, `license_plan`, `modules_enabled` | Public API/WS/terminal origins and trading-server connection settings |
| `/api/v2/broker/config`, unauthenticated | `broker_name`, `server_name`, `status`, `supported_currencies`, `default_leverage`, `max_leverage`, `registration_enabled`, `demo_registration_enabled`, `support_email`, `theme_color`, `logo_url`, `terms_url`, `privacy_url` | `broker_id`, public API/WS/terminal origins and trading-server connection settings |

`/api/v2/brokers` wraps the same broker-detail fields in `{brokers, count}`. The public config endpoint is scoped to the gateway's server-owned broker; its `broker_id` query parameter is a consistency assertion, not a tenant selector. The authenticated config response additionally includes broker identity and administrative feature/limit fields.

`services/gateway/handlers/broker_servers.go` deliberately substitutes an opaque `broker-server-<id>` registry handle for the registered server address. Its tests explicitly prohibit public `server_ip` and `server_port`. The observed `broker-server-3` identifies a registered server/proxy entry; it is not evidence of an actual MT5 server name or hostname. The directory's `protocol=http` also describes its registered backend transport and does not justify downgrading browser API or WebSocket connections from HTTPS/WSS.

`services/gateway/handlers/brokers.go` supplies public identity/presentation metadata, and `services/gateway/handlers/withdrawal_flow.go` supplies the public configuration projection. These contracts do not currently supply the safe public origins needed to connect a newly registered broker automatically. `docs/BROWSER-FEED-CONTRACT.md` advertises discovery feed URL fields that the inspected actual directory handler and live response do not emit; that source/documentation discrepancy must be resolved rather than guessed around in the frontend.

## Live Achiever results

Requests were made to the supplied origin `https://service.achiever.orrnn.com` on 2026-10-01. Results can change as the deployment is repaired.

| Public request | Observed response |
|---|---|
| `/api/v1/market/symbols` | 404 |
| `/api/v1/market/symbol-list` | 404 |
| `/openapi.json` | 404 |
| `/api/v2/broker/servers` | 200, including `broker_id=achiever`, `broker_name=achiever`, `server=broker-server-3` |
| `/api/v2/brokers/achiever` | Public identity `broker_id=achiever`, but `name=Orrnn Global Demo Broker`; `logo_url=null` |
| `/api/v2/broker/config?broker_id=achiever` | `broker_name=Orrnn Global Demo Broker`, `server_name=RTX5-Live`; anonymous response omits `broker_id` |
| `/api/v2/broker/config?broker_id=OtherBroker` | JSON `BROKER_MISMATCH`; query cannot select another tenant |
| `/api/v2/instruments`, no broker assertion | 503 |
| `/api/v2/candles/XAUUSD?timeframe=M1&limit=1`, no broker assertion | 503 |
| `/api/v2/instruments` and `/api/v2/quotes`, `X-Broker-ID: Achiever` | 403 JSON `BROKER_MISMATCH` |
| `/api/v2/instruments` and `/api/v2/quotes`, `X-Broker-ID: achiever` | 503 JSON `BROKER_SCOPE_UNAVAILABLE`, message `Broker market-data scope is unavailable` |

The case-sensitive identity `achiever` is supported by both the public directory row and the gateway's mismatch response. The modern public middleware is deployed and reachable. Its unavailable broker scope is a backend configuration or data issue; the HTTP response does not identify the exact failed database/feed setting.

The wrong Achiever public name is returned by backend identity/configuration endpoints, while the server directory calls that broker `achiever`. It is therefore a backend metadata inconsistency, not evidence of a frontend fallback to a different broker. The frontend should not substitute an invented broker name. The inspected `scripts/vps/pre-deploy.sh` contains Orrnn names when seeding a configurable broker ID, and manager provisioning does not update an existing broker name in its conflict path. These are plausible source causes; the public reads do not prove that either path ran in this deployment.

## Registration and terminal provisioning boundary

The inspected legacy broker-registration handlers insert broker and registered-server records. Manager `ProvisionManager` additionally bootstraps the broker, server entry, and manager account through authenticated provisioning. Its server address comes from configured `BROKER_SERVER_IP` / `BROKER_SERVER_PORT`, and the provisioning JWT must match the configured broker identity. Backend credentials stay in that privileged provisioning flow.

Those inspected handlers do not generate Web Terminal runtime configuration, create terminal containers, configure public DNS/TLS origins, or update terminal deployment environment variables. Registration alone therefore does not complete automatic terminal wiring. The deployment panel or backend provisioning service must emit the complete safe public settings for a per-broker terminal, or provide a trusted public routing contract plus the required backend routing support for a central terminal picker. The frontend consumes that contract; it must not derive domains from broker names or treat supplied frontend credentials as authorization to register a broker. No registration or provisioning operation was invoked during this audit.

## Backend and deployment-panel work outside this repository

1. Pass the intended broker's complete public runtime settings into the Web Terminal container. Saving panel settings without forwarding them to the container is insufficient.
2. For the inspected Achiever deployment, use the confirmed case-sensitive `BROKER_ID=achiever`. Treat `broker-server-3` as the registry's opaque server handle. Obtain and verify any required actual trading-server name from authoritative backend/provisioning settings; it was not established by this public directory read.
3. Inspect gateway server-side broker identity, active broker status, feed enabled status, configured symbol scope, and database availability to resolve `BROKER_SCOPE_UNAVAILABLE`. Frontend settings do not grant backend access.
4. Allow the deployed terminal origin and `X-Broker-ID` in the broker gateway's existing CORS policy. Keep HTTPS/WSS and current authorization checks.
5. If choosing legacy bridge mode, configure and verify the documented MT5 bridge routes at the same broker origin. The current Achiever origin does not expose those two inspected catalog routes.
6. Correct the Achiever backend public name and reconcile broker identity/presentation records with the server directory. Do not mask the wrong backend metadata with frontend hardcoding.
7. Wire registration/provisioning to terminal runtime generation, or extend the trusted registry with validated public routing fields and matching backend support. Existing directory records alone cannot safely provide automatic routing for new brokers.

No live login, quote delivery, or trading success was verified. The frontend tests establish configuration and request isolation, supported URL construction, payload compatibility, and fail-closed behavior. They do not repair or prove the backend's feed scope.
