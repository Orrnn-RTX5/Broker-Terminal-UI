# Broker-neutral Web Terminal release

The container generates one complete, public configuration at startup. The same image can be started for different brokers without recompiling. No commit, image publication, or deployment was performed for this change.

## Runtime environment

The backend/panel generates the public runtime settings from the registered broker record. This Achiever example illustrates public identity/origins, not application defaults. The directory's `broker-server-3` is an opaque registered server/proxy handle, not a verified MT5 server name. Supply the backend-provisioned trading-server setting before deployment. These requests did not verify login, a working market feed, or trading.

Copy the complete [public environment template](broker-runtime.env.example) into the deployment's env file and replace the values for another broker.

```dotenv
BACKEND_TARGET=web
API_HOST=https://service.achiever.orrnn.com
WS_HOST=wss://service.achiever.orrnn.com
BROKER_ID=achiever
# Required; supplied by backend provisioning, never guessed from a directory handle.
DEFAULT_MT5_SERVER=

# Optional. Omit or leave empty to use API_HOST.
API_HOST_EXT=https://service.achiever.orrnn.com

# Optional trusted catalog base, without /api/v2/broker/servers.
# Achiever exposes that public directory on its API origin.
DISCOVERY_BASE_URL=https://service.achiever.orrnn.com
BROKER_DISCOVERY_URL=https://service.achiever.orrnn.com

# Optional: defaults to BROKER_ID. Use only the backend's actual feed identity.
FEED_BROKER_ID=achiever

# Supported modern gateway contract; does not require the MT5 HTTP bridge.
PUBLIC_MARKET_API=gateway-v2
PUBLIC_CANDLE_BRIDGE=false
USE_MOCK_DISCOVERY=false

# Optional public presentation and intentional additional broker service origins.
BROKER_NAME=Achiever
BROKER_LOGO_URL=
BROKER_LOGIN_HERO_URL=
BROKER_LOGIN_HERO_MOBILE_URL=
BROKER_TERMS_URL=
BROKER_ALLOWED_ORIGINS=
```

For another broker, change API/WS origins, the exact case-sensitive broker ID, trading server, and optional catalog/presentation/feed values. There is no required domain prefix or broker hostname list. HTTPS/WSS origins cannot contain userinfo, API paths, query strings, or fragments. WS_HOST also accepts a known `/ws/v2` or `/ws/feed` endpoint and normalizes it to the configured origin before constructing socket paths.

Separate service authorities require explicit public HTTPS origins in `BROKER_ALLOWED_ORIGINS`, for example `https://quotes.example.net,https://market.example.org`. This setting expresses deployment routing trust. It does not grant backend authorization. The discovery catalog is a separate authority and does not automatically become a destination for account credentials.

`API_HOST`, `WS_HOST`, `BROKER_ID`, and `DEFAULT_MT5_SERVER` are required in a production container. Discovery may be omitted; it remains empty rather than inheriting a compiled catalog. `API_HOST_EXT` defaults to API_HOST, FEED_BROKER_ID defaults to BROKER_ID, and no privileged feed token is emitted. Production mock discovery is rejected.

## Adding a new broker with an environment file

For the existing per-broker deployment, backend registration plus a complete public terminal `.env` file is sufficient for frontend configuration. Copy `broker-runtime.env.example`, set API_HOST, WS_HOST, the exact registered BROKER_ID and DEFAULT_MT5_SERVER, and use the same approved image with `docker run --env-file .env ...` or Compose env_file. A container must be recreated after env changes; merely editing a host file does not change an existing container. No frontend code entry, hostname allowlist, broker-specific source block or per-broker rebuild is required.

For `npm run dev` / `npm run dev:web` on port 5173, Vite uses `.env.web` and `.env.web.local`; restart Vite after changing the active profile. Container startup uses the runtime `.env` passed into the container and overrides the entire compiled profile. Unprefixed and VITE_ aliases work for the documented public fields. Never put backend credentials in VITE_ variables or browser-visible config. Account users continue to log in with their own account credentials.

Backend registration and manager/server credentials must be provisioned on the backend independently. A frontend `.env` does not create database registrations, enable feeds, grant permissions, fix CORS/TLS, or install a different API contract. The same-image guarantee is about frontend broker configuration, not a promise that every future backend or deployment can never fail.

## Backend-managed registration

The backend is the registration authority. Backend registration/provisioning must supply the broker's exact ID, presentation, public service origins, and trading-server configuration. Trading-server passwords, manager credentials and signing secrets stay in backend provisioning. The frontend receives the registered public connection settings and ordinary account-session credentials; it has no list of permitted broker names or domains.

For the existing per-broker terminal URL design, backend/panel provisioning must emit the registered broker's complete public settings in the existing deployment payload's `.env` object. `.github/scripts/deploy-broker-ui.sh` forwards that object into the container; `docker-entrypoint.sh` serializes its public allowlisted fields. This is an integration boundary, not a request to add a source-code block or rebuild the image for each registration. The deployment ID used for filenames/container labels can differ from the backend's canonical BROKER_ID; the public identity must be the backend's exact value.

The inspected gateway directory currently publishes IDs/names and opaque server handles, but intentionally omits public API/WS routing origins. Its registration/provisioning handlers do not create terminal environment files, DNS/TLS records, or terminal containers. Registration alone therefore does not complete automatic terminal onboarding today. The backend/panel must implement that provisioning handoff, or provide an authoritative public routing contract before a central multi-broker browser picker can use discovery alone. No such endpoint or fallback was invented here.

`src/services/brokerDirectory.ts` now preserves every distinct exact backend ID when merging published directories. Shared display names, shared gateways and case-distinct IDs cannot hide new registrations. `WelcomeTerminal.tsx` restores exact registered IDs; a legacy saved address is accepted only if it identifies one broker. A forced backend directory refresh exposes new rows without a frontend code change. This was verified with simulated backend registration responses, not a live registration.

Fresh Achiever reads also show inconsistent backend branding: the directory says `achiever`, while its public broker record/config says `Orrnn Global Demo Broker`. That name comes from backend metadata. Backend seed/provisioning data must be corrected separately; the frontend should not invent a replacement or inherit another broker's identity. See the [API evidence](broker-api-compatibility-2026-10-01.md).

## Alias precedence

For each family below, all unprefixed keys take precedence over `VITE_` keys. Within a group, the order shown determines precedence. An explicitly present empty primary value clears lower-priority aliases; it cannot revive a compiled broker.

A complete `CONFIG_SOURCE=deployment` object also takes precedence across all three supported legacy browser configuration globals. Fields are never merged with a compiled object. Conflicting deployment objects stop startup rather than selecting a broker by script load order.

| Setting | Supported names in priority order, then their VITE_ equivalents |
| --- | --- |
| Transport | BACKEND_TARGET, BACKEND_MODE |
| API | API_HOST, API_URL, BACKEND_URL, RTX5_API_URL, API_V2_URL, FIX_API_URL |
| Extended API | API_HOST_EXT, API_URL_EXT, BACKEND_URL_EXT |
| WebSocket | WS_HOST, WS_URL, RTX5_WS_URL, MARKET_WS_URL, FIX_WS_URL |
| Discovery | DISCOVERY_BASE_URL, BROKER_DISCOVERY_URL, SHARED_DISCOVERY_BASE_URL |
| Broker ID | BROKER_ID |
| Trading server | DEFAULT_MT5_SERVER |
| Feed identity | FEED_BROKER_ID |
| Additional origins | BROKER_ALLOWED_ORIGINS |
| Public market contract | PUBLIC_MARKET_API |
| Public candle bridge | PUBLIC_CANDLE_BRIDGE |
| Public presentation | BROKER_NAME, BROKER_LOGO_URL, BROKER_LOGIN_HERO_URL, BROKER_LOGIN_HERO_MOBILE_URL, BROKER_TERMS_URL |
| Mock discovery | USE_MOCK_DISCOVERY |

`EXTRA_BROKER_DISCOVERY_URLS` and its VITE_ alias remain available to the explicit Electron/desktop selection workflow. A pinned web deployment never searches additional catalogs or selects another broker when its own catalog fails. Electron retains its independently selected broker and direct/local transport exceptions. Vite loopback development retains its authenticated, origin-validated reverse proxy; production TLS requirements remain in force.

Only allowlisted public configuration fields are serialized. Backend passwords, signing/private keys, database credentials, privileged API keys, and permanent feed tokens must stay on the backend. Do not prefix secrets with VITE_.

## Root causes and corrected paths

| Problem | Correction and relevant files |
| --- | --- |
| Broker-specific hostname rules and WEB_BACKEND_FALLBACK | The supplied dirty checkout had already removed the literal allowlist/fallback. `src/config/backendTarget.js` still mixed runtime and build aliases and trusted arbitrary selected metadata when configuration was absent. It now uses `brokerRuntimeConfig.ts`, a complete deployment source, secure URL validation, and explicit permitted origins. No list was extended with Achiever. |
| Sparse container overrides retained a compiled broker | `docker-entrypoint.sh` now generates configuration from startup env alone and validates required settings before Nginx starts. `Dockerfile` no longer retains a compiled runtime-config base template. JavaScript escaping and atomic replacement are preserved. |
| Compose overrode panel settings with Orrnn values | `docker-compose.yml` loads the selected deployment env file and supports a chosen image/container/host binding. It no longer supplies Orrnn API, socket, broker ID, or server values. Registry ownership is a release location, not a broker routing fallback. |
| CI/helper allowed missing environment and broker-specific labels/CORS | `.github/workflows/deploy.yml` and `.github/scripts/deploy-broker-ui.sh` require a supplied runtime env file. The helper's optional managed backend vhost permits the exact configured HTTPS terminal origin instead of a Grow Trading Academy domain regex. Workflows were inspected and edited, never triggered. |
| Invalid configuration could warm public requests before app validation | `viteWebRuntimeConfig.ts` emits a shared validator, loaded before runtime configuration and startup requests in `index.html`. `bootstrap.tsx` displays a configuration error before preloading/mounting the terminal. Runtime scripts use no-store headers in `nginx.conf`. |
| API clients bypassed runtime with direct import.meta.env/base fallbacks | `src/config/api.ts`, `src/api/brokerRequestGuard.ts`, `src/api/client.ts`, `src/api/brokerApi.ts`, `src/api/endpoints.ts`, `src/api/tradeGateway.ts`, and `src/services/api.ts` resolve deployment/session-owned endpoints. Invalid or foreign final URLs are rejected before network requests. Redirects cannot move credential bodies to another origin. |
| Cached URL builders exposed a stale route between synchronous session events | `src/config/api.ts` builds HTTP/socket URLs from the current deployment getters and validates the assembled URL. Socket paths are constructed once, avoiding duplicate `/ws/v2` segments. Existing cached compatibility exports remain guarded by their SDK consumers. |
| Development proxy trusted stale aliases and disabled public TLS verification | `vite.config.ts` derives proxy destinations/trust from the validated canonical configuration, learns only the pinned broker's catalog row, separates discovery from credential endpoints, and verifies HTTPS/WSS certificates. Explicit local HTTP/WS development routing and SSRF/DNS protections remain. Trusted local TLS can use Node's normal extra-CA configuration. |
| Persisted broker IDs, sockets, tokens, branding and startup selection overrode deployment | `src/services/brokerSession.ts`, `brokerLoginPolicy.ts`, `brokerDirectory.ts`, `brokerDisplayName.ts`, `webTrader.ts`, `src/startup/configuredWebSession.ts`, `src/components/WelcomeTerminal.tsx`, `LoginDialog.tsx`, `src/hooks/useBrokerLoginPolicy.ts`, and `src/app/session/authSessionStorage.ts` / `useAppSessionLifecycle.ts` enforce exact deployment identity and routing before restore. Configuration changes invalidate incompatible credentials and caches; web startup does not choose the first discovered broker. |
| Hostname-specific socket behavior skipped authentication | `websocket-enhanced.ts` no longer bypasses auth or rewrites routing for fixapibackend hostnames. Socket construction/reconnect uses the current configured broker/session. `tradeSocket.ts` checks explicit caller URLs and token ownership. |
| TEST/FXTrust broker names selected a candle bridge | `src/services/chartDataService.ts` uses the explicit PUBLIC_CANDLE_BRIDGE capability. `publicMarket.ts` and `publicMarketCatalog.ts` use the supported PUBLIC_MARKET_API contract; no domain or broker name chooses an API version. |
| Direct consumers used raw tokens, relative API fallbacks, or fake account identity | `src/components/SymbolsDialog.tsx`, `src/hooks/useToolboxTradeData.ts`, `src/components/layout/TopToolbar.tsx`, and `src/services/drawingApi.ts`, `bugReportService.ts`, `marketWatchActions.ts`, `chartPrinter.ts`, and `authenticatedInstruments.ts` use scoped credentials and validated destinations. The fabricated RTX-000001 trading account default is removed. |
| Public caches and pending responses survived a broker change | `src/startup/earlyPublicStartup.ts`, `publicHistoryPrefetch.ts`, `src/services/publicMarketCatalog.ts`, `brokerPresentation.ts`, and HTTP/candle/socket completion handlers capture and recheck exact broker/session ownership before delivering results. Brand metadata cannot replace the pinned broker. |
| Automation defaults preauthorized an unrelated hardcoded host | `src/store/useSettingsStore.ts` now starts with an empty WebRequest URL permission list instead of backend.yoforexai.com. Existing user-saved settings are preserved. This preference was not used by broker transports; the audit removed an inappropriate cross-deployment default. |

Broker names/domains no longer select login artwork or theme variants. `welcomeHeroAssets.ts` reads explicit public HTTPS artwork settings for pinned web deployments or independently selected desktop directory metadata. The existing visual variant is named `accent` and has no broker-name condition. Bundled historical artwork files remain available as assets but are not chosen through hardcoded broker identity rules. `OpenAccountDialog.tsx` uses the configured BROKER_TERMS_URL and does not point another broker to a fixed legal domain.

The remaining TEST/fxtrust candle-auth identity alias is removed in desktop mode too: backend broker IDs are exact and case-sensitive. Valid authenticated candle test fixtures now use matching IDs; distinct or case-distinct IDs cannot send credentials, including formerly aliased names. The local Vite env-file checker now uses the same alias precedence as runtime generation, so unprefixed BACKEND_URL and other documented API aliases are accepted rather than accidentally blocking a new broker.

Legitimate test domains and identities, protocol constants, market timeframes, local/private development rules, SVG namespaces, internal container service ports, and the Electron release repository remain. GitHub release ownership and third-party finance/documentation links are shared product resources, not broker destinations or broker authorization rules. No other repository was modified.

## API and external deployment issues

The default `gateway-v2` public market contract reads `/api/v2/instruments` and `/api/v2/quotes`, joining quote metadata by exact symbol. Candles use the supported `/api/v2/candles/{symbol}` route. Anonymous market requests send `X-Broker-ID` as a consistency assertion. Backend identity, broker feed enablement, tenant symbol scope and authorization remain server-enforced.

Legacy deployments may explicitly select `PUBLIC_MARKET_API=mt5-bridge-v1`, which uses the existing `/api/v1/market/symbols` contract. `PUBLIC_CANDLE_BRIDGE=true` selects the already supported public candle bridge when that backend requires it. These options never change the broker destination.

Achiever returned 404 for v1 symbols and symbol-list; v2 instruments/quotes with the verified `achiever` identity returned 503 `BROKER_SCOPE_UNAVAILABLE`. A deliberately incorrect `Achiever` header returned 403 `BROKER_MISMATCH`. Its public directory returned the verified identity and server above. Therefore the backend/panel must provision the active broker, enabled broker_feed_config and explicit cserver_symbols market scope. The exact failing backend prerequisite was not determined. If choosing legacy bridge mode, the backend reverse proxy must actually serve the documented bridge routes. See [API evidence and contract details](broker-api-compatibility-2026-10-01.md).

The panel must deliver these public settings to the running container, recreate it when settings change, and use the correct case-sensitive ID. Existing deployed assets remain unchanged until an approved corrected release is deployed. Backend CORS must authorize the terminal origin and X-Broker-ID header; TLS and authentication must remain enabled. Backend authorization cannot be replaced by frontend settings.

There is no service worker implementation or registration in this repository; `main.tsx` retires older workers asynchronously. Users with an older release's already-loaded document or worker must navigate/reload to obtain the release. Purge stale hosting/CDN HTML/runtime caches during the approved rollout and confirm served configuration, rather than relying on panel saved values alone.

## Verification and approved release procedure

Automated results and limits are recorded with this release's verification artifacts. Tests exercise arbitrary secure broker domains, runtime Achiever over compiled Orrnn, missing/malformed/mixed origins, stale sessions/storage, account scope, socket construction/reconnect, public contract selection and actual container entrypoint shell execution. They assert rejected configuration creates no broker request or credential-bearing socket.

The focused regression runs cover **1025 test cases across 67 files, all passing**, taking the latest report for each file and retaining individual parameterized cases. This is not a full repository test run. Major final runs: 137 configuration/startup/proxy cases, 229 session/bootstrap cases, 348 API/consumer cases, 65 entrypoint/DNS cases, 83 backend-directory/selection cases (16 added registration regressions), and additional focused UI/startup/URL-builder regressions; counts overlap across runs. The final environment-only followup covers 260 cases across 10 files, all passing. Its earlier failed test runs are superseded per file by the successful reruns recorded in `artifacts/broker-env-only-followup-verification.json`. The 57 entrypoint/deployment contracts include 54 actual Git Bash entrypoint executions, two managed CORS-function checks, and four static wiring/cache checks.

`npm.cmd run typecheck`, `npm.cmd run build:web`, markdown link validation, shell syntax/YAML parsing, and `git diff --check` pass. The build logs Vite's expected warning about the deliberately blocking classic validator script, existing mixed dynamic/static imports, and large chunks. The output compiles successfully; these warnings do not establish Lighthouse performance.

The rebuilt HTML/validator assets were reused with the real entrypoint for Achiever, an unrelated domain, and a previously unknown domain. All three generated valid isolated configuration; missing settings rejected startup. At port 5173, both served runtime scripts returned 200 with no-store headers and agreeing canonical globals. These checks use JavaScript evaluation and shell execution, not an authenticated browser or Docker engine. The latest built-assets evidence is `artifacts/broker-env-only-built-assets-smoke.json`; it also checks optional public presentation settings and exclusion of private credentials.

Evidence files in the local workspace: `artifacts/broker-release-verification.json`, `artifacts/broker-release-build-results.json`, `artifacts/broker-release-build.log`, `artifacts/broker-built-assets-smoke.json`, `artifacts/broker-vite-served-runtime-smoke.json`, the environment-only followup report/build/smoke artifacts, and the per-suite JSON reports referenced by the aggregate. They contain public configuration/test metadata and are excluded from the image build context.

The environment does not provide the Docker CLI/engine. The actual shell and generated JavaScript were tested; an actual Docker image build/run is still required in the release environment. No authenticated live login, quote stream, or trading was attempted. Achiever market-data scope currently prevents successful anonymous instruments/quotes.

After approval, from a reviewed release checkout:

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd run build:web
docker build --build-arg VITE_MODE=web -t rtx5-webterminal:broker-neutral .

# Save the template above as .env.achiever.
# The exact same locally built image is reused for each separately configured broker.
docker run --rm --env-file .env.achiever -p 127.0.0.1:8080:80 rtx5-webterminal:broker-neutral
docker run --rm --env-file .env.second-broker -p 127.0.0.1:8081:80 rtx5-webterminal:broker-neutral
```

For Compose, set `$env:BROKER_ENV_FILE='.env.achiever'` and `$env:WEB_TERMINAL_IMAGE='rtx5-webterminal:broker-neutral'`, then use the repository's Compose configuration. Set a unique container name/bind per broker. Confirm startup exits on an incomplete env file; inspect served runtime-config.js/inline config and network destinations for both brokers. Resolve backend scope/CORS/TLS issues and verify account restore with an authorized test account before approving publication/deployment. Use a reviewed, pinned release tag/digest when publishing; existing automatic deployment workflows require approval before triggering.
