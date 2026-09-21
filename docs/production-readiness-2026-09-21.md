# Frontend production readiness audit - 2026-09-21

**Decision: issues are present. The current checkout cannot yet be signed off for a high-concurrency production launch.** Successful builds and a responsive home page do not establish session continuity, safe releases, or capacity. The confirmed problems below should be addressed, and the actual release candidate should pass the staging gates before a supported traffic limit is announced.

This was a read-only application/deployment audit following the [code cleanup](code-cleanup-2026-09-21.md). Only this report and audit evidence were added during this audit. No production code fixes, deployment, SSH access, authenticated broker requests, real trades, or public load tests were performed. Existing working-tree changes were preserved.

The public site checked was **https://nexa-terminal.orrnn.com**, identified in the repository's deployment/startup evidence. The user has not confirmed the intended production host, peak concurrency, or infrastructure. Public results below apply to this host at approximately **09:42-09:44 UTC on September 21**, not every broker deployment. Its served entry hash differs from the local build, so source findings are not automatically claims about the currently deployed JavaScript.

## Confirmed findings and release priorities

P1 means fix or explicitly resolve before release under the stated trigger. P2 means reliability, scaling, or hardening work with an explicit acceptance test. Conditional findings are not represented as observed outages.

| ID | Priority and evidence | Problem and production consequence | Required action |
| --- | --- | --- | --- |
| D1 | P1, isolated shell reproduction | Standalone runtime overrides can be silently ignored. Supplying only a recognized broker override can instead reset omitted API/WS settings to generic defaults. A successful container start can therefore use the wrong routing/configuration. | Merge explicit overrides with validated defaults, or reject incomplete configuration; cover every supported variable. |
| D2 | P1 if the local defaults are deployed unchanged, fresh HTTP plus source | The local build points discovery directly at a cross-origin endpoint that returned no `Access-Control-Allow-Origin` for the Nexa frontend. The current deployed site uses a working same-origin discovery proxy instead. | Preserve the production proxy and public runtime settings, or configure the directory's CORS correctly. Verify the served config from the final image. |
| A1 | P1 for uninterrupted sessions, extracted-source reproduction | The shared HTTP client's reactive refresh updates storage but not the store expiry. App validation/timers prefer the stale store value and can log out a successfully refreshed session. | Commit token and expiry through one session owner; verify old-expiry crossing and concurrent refresh/account changes. |
| D3 | P2, observed live policy; high impact during an affected release | A nonexistent JS asset returned a real 404 with `Cache-Control: max-age=14400`; a repeat was a Cloudflare cache HIT. A transient missing chunk can remain unavailable to clients after it is restored. | Make missing assets non-cacheable through origin, ingress and CDN; test the effective public response. |
| D4 | P1 when old assets are removed, source-supported release scenario | An open version-A terminal can request an unfetched version-A lazy chunk after version B replaces the static image. No Vite preload-error recovery was found. | Retain old immutable assets for a compatibility window and provide controlled version recovery that protects unsaved actions. |
| R1 | P1 under outage/recovery load, source | Primary candle reconnects have no jitter and reset backoff immediately on socket opening. Other socket delays lose jitter at their cap. Correlated disconnects can cause repeated reconnect bursts. | Keep jitter effective at the cap; reset after a stable/ready connection; test a fleet reconnect and repeated open/drop failure. |
| R2 | P2, source | Important candle, BrokerAPI and toolbox fetches lack a consistent local deadline. Some obsolete quote requests continue after their consumer changes. | Add bounded deadlines, cancellation ownership and shared concurrency budgets. |
| R3 | P2 before large anonymous traffic, source plus public payload measurement | Guest tabs repeatedly fetch the entire symbol catalog and each chart's candles, with fixed retry cadence even after errors. No `Retry-After` scheduling was found in these loops. | Bound public demand; use adaptive backoff and a suitable quote endpoint/stream; stage-test 429 and overload recovery. |
| D5 | P1 **only if the legacy script is used**, source | The old deploy script removes the healthy container before validating the replacement and has no rollback path. | Verify the actual infra pipeline; validate a candidate before switching traffic, drain, and retain image/config rollback. |
| S1 | P1 **if the feed credential is privileged**, dummy-data reproduction | The Docker entrypoint accepts server-named feed tokens and publishes them in public runtime JS/HTML. The live config contains a token field, but its privileges were not examined. | Establish the token's intended public scope. Never give a browser a credential whose secrecy is an authorization boundary. |
| T1 | P1 acceptance gate, source-supported disconnect scenario | One-click trading does not directly gate on the displayed tick's age or browser quote-connection state. Backend symbol eligibility may remain fresh while the browser displays an old quote. | Verify and enforce freshness of the actual displayed quote at submission; preserve authoritative backend execution checks. |
| T2 | P1 acceptance gate, source-supported ambiguous REST outcome | A lost REST-create response is rethrown as failure without reconciling the original order UUID. A later manual retry gets a new UUID. | Simulate accepted-order/lost-response cases; reconcile the original intent before inviting a retry. No duplicate execution was demonstrated here. |

### D1: runtime override proof

[`docker-entrypoint.sh`](../docker-entrypoint.sh), lines 71-85, decides whether to preserve the built config using only a subset of broker/API variables. Five isolated trials supplied `WS_HOST`, `DISCOVERY_BASE_URL`, `API_HOST_EXT`, `FEED_BROKER_TOKEN`, or `USE_MOCK_DISCOVERY`: each completed successfully while leaving the old dummy field unchanged.

A separate successful trial supplied `BROKER_ID=OVERRIDE` and a dummy server-named feed token. Previously configured `.example` API/WS values became `https://backend.orrnn.com` and `wss://backend.orrnn.com`; the dummy token appeared in browser configuration. This also proves S1's publication mechanism. The Vite generator deliberately excludes server-only token names ([`viteWebRuntimeConfig.ts`](../viteWebRuntimeConfig.ts), lines 60-62), so the two generation paths have different boundaries.

Three initial shell trials hit a local Git Bash timeout; those are tooling limits, not application failures. The successful trials and rerunnable scripts are in the evidence directory. No real secret is included.

### D2: the next deployment must preserve discovery routing

The generated local build contains `DISCOVERY_BASE_URL=https://fxtrustsuperbackned.orrnn.com`. A public GET to that base plus `/api/v2/broker/servers`, with `Origin: https://nexa-terminal.orrnn.com`, returned 200 JSON but **no allow-origin header**. The served deployment instead configures `https://nexa-terminal.orrnn.com/discovery-api`; its directory request returned 200 JSON from the same origin.

[`backendTarget.js`](../src/config/backendTarget.js), lines 243-262, selects the runtime discovery base; [`api.ts`](../src/config/api.ts), line 445, exposes it; [`brokerDirectory.ts`](../src/services/brokerDirectory.ts), line 93, fetches it. The local Vite proxy is DEV-only ([`localDevProxy.ts`](../src/config/localDevProxy.ts), lines 16-18). WelcomeTerminal and OpenAccountDialog consume this directory.

**Inference from the observed HTTP headers and this source path:** a browser using the unmodified local discovery default from the Nexa origin will block reading that directory response. This was not reproduced in an interactive browser. A plain command-line 200 does not prove browser CORS success. [MDN CORS documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS).

### A1: refreshed-token expiry proof

[`client.ts`](../src/api/client.ts), lines 404-418, saves the refreshed access token and new expiry to localStorage. It emits `auth:token-updated` without updating Zustand. [`App.tsx`](../src/App.tsx), line 804, prefers the previous `tokenExpiresAt` from Zustand; lines 994-1022 validate it every second and schedule logout from it. The inspected event listeners do not synchronize the new expiry into the store. The separate BrokerAPI refresh path does update the store correctly.

The reproduction extracts the actual App validator and its helpers using TypeScript's AST, then supplies synthetic state. A future expiry in storage plus an elapsed store expiry yields `accepted:false` and `token_expired`; a synchronized-store control succeeds. This proves the faulty decision, not a full authenticated refresh transaction. Also verify the intended renewal policy for a continuously foreground tab: current proactive renewal is focus/visibility driven, while expiry can terminate the session before a refresh attempt.

### D3/D4: caching and release compatibility

The missing asset probe `/assets/rtx-audit-missing-20260921.js` returned 404 and `max-age=14400`. A repeat returned `CF-Cache-Status: HIT`, `Age: 30` in one location; another location returned MISS. **Four hours is the browser-facing freshness lifetime; the edge TTL was not established.** This differs from the checked-in [`nginx.conf`](../nginx.conf), lines 42-44, which specifies a no-store missing-asset response. Attribution to the deployed origin, ingress or CDN rule requires actual infrastructure inspection. [Cloudflare distinguishes browser and edge cache TTL](https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/).

The Docker image contains one build's `dist`. App and toolbox features have lazy imports. Existing component Retry buttons reset error state, which does not restore deleted chunk URLs. A startup timeout **does have a full-page reload fallback**, so recovery is not wholly absent; it does not establish recovery for every feature opened later. Vite documents the old-client/deleted-chunk failure and `vite:preloadError`. [Vite 7 production build guidance](https://v7.vite.dev/guide/build#load-error-handling).

## What was verified on the public deployment

| Probe | Observed result | What it proves / does not prove |
| --- | --- | --- |
| HTML `/` | 200, Brotli, `Cache-Control: no-store`, TLS 1.3 with valid certificate chain | Static delivery succeeded for this request; not terminal readiness. |
| `/runtime-config.js` | 200, Brotli, no-store; Nexa API/WS and same-origin discovery proxy | Served routing differs from the local build's discovery default. Token presence was recorded only as a boolean. |
| Referenced entry JS | 200, Brotli, one-year immutable, Cloudflare MISS | Entry exists and has an appropriate successful-asset cache policy. No CDN hit ratio was measured. |
| Deliberately missing JS | 404, `max-age=14400`; repeat cache HIT | Confirms the negative-cache policy issue above; it did not return a 200 SPA shell. |
| Nexa public symbol catalog | 200, 701 symbols, 76,449 decoded bytes, no-store, allow-origin matching the Nexa frontend | This anonymous endpoint's CORS works. Does not prove login/order preflights or authenticated feed access. |
| Served same-origin discovery route | 200 JSON, 9 directory rows | The documented deployment's proxy responded successfully. |
| Local build's direct discovery endpoint | 200 JSON, 9 directory rows, no allow-origin header | Reachable outside a browser; unsuitable for the observed cross-origin browser read without configuration changes. |

The tested responses did not include HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy or Permissions-Policy. Treat this as a hardening gap, not proof of an exploit. Establish a deliberate framing policy for the trading UI, use CSP compatible with runtime inlining/workers/connections, and verify it at the public edge. Do not blindly add a policy that blocks the application's inline bootstrap.

Only nine low-rate public GETs were used across delivery, cache rechecks and public API checks. Individual response times are recorded for diagnosis; they are not percentile, regional or capacity measurements.

## Capacity model: daily users are not concurrent users

Frontend files are static, but the loaded application creates continuing backend demand. A CDN can absorb static downloads; it does not by itself increase the broker API/feed capacity.

For a normal authenticated tab with quote demand and **C visible charts**, source indicates approximately **3 + C WebSockets**: general/account, shared quotes, warmed trade transport, and one independent candle stream per chart. Default C=1 gives 4; six charts gives 9. Higher-timeframe chart panes still subscribe to individual M1 streams, including duplicate subscriptions when symbols match. There is no cross-tab transport sharing. Hidden dock panes release chart resources, but hidden browser tabs can retain sockets.

For a visible guest tab, approximate fast-response demand is **(C + 1) / 3 + 1 / 30 requests/second**: whole catalog, each chart, and feed status. Polling waits for a response before the next delay, so slow responses reduce the regular rate; failures/fallbacks and interaction can add requests. Do not count the generic retry helper as active traffic: no production callers were found.

| Concurrent visible tabs | Auth sockets: 1 / 6 charts | Guest requests/sec: 1 / 6 charts |
| --- | ---: | ---: |
| 100 | 400 / 900 | 70 / 237 |
| 1,000 | 4,000 / 9,000 | 700 / 2,367 |
| 10,000 | 40,000 / 90,000 | 7,000 / 23,667 |

These are **offered-load estimates, not supported-capacity results**. A mixed audience needs separate authenticated and guest tab counts; do not add both whole-population columns. Multiply sockets for multiple tabs per user, include background tabs, and model chart/symbol distributions.

With no user-provided traffic target, an illustrative daily model uses **one 30-minute session per daily user, one tab per session, an eight-hour active window, and a 3x peak factor**:

`peak tabs = ceil(daily users x 0.5 hours / 8 hours x 3)`

| Daily users | Illustrative peak tabs | Auth sockets, 1 chart | Guest requests/sec, 1 chart | Cold asset transfer/day* |
| --- | ---: | ---: | ---: | ---: |
| 1,000 | 188 | 752 | 132 | 0.81 GB |
| 10,000 | 1,875 | 7,500 | 1,313 | 8.11 GB |
| 100,000 | 18,750 | 75,000 | 13,125 | 81.11 GB |

*Only the measured gzip size of HTML-linked/terminal-preloaded code and styles, assuming one cold load each; excludes HTML, fonts, images, locales, later features and API/feed traffic. Browser/CDN caching and actual Brotli delivery change these numbers. Longer sessions or market-open bursts can raise concurrency substantially. No tier is certified here.*

For the observed catalog, fast polling decodes about **25.5 KB/sec per guest tab** just for the whole-catalog payload. Compression reduces wire bytes; this decoded number is not network bandwidth. At 1,000 guest tabs it is roughly 333 catalog requests/sec plus chart/status traffic. Feed bandwidth additionally depends on actual messages/sec, subscribed symbols, payload sizes and fan-out, none of which daily-user totals specify.

## Browser performance and long-session pressure

The current local web build's HTML-linked assets plus conditional terminal preloads total **811,139 gzip bytes across 16 hashed JS/CSS files plus runtime config**. This is a static preload inventory, not a measured waterfall. Web guest startup also enters the terminal preload path. Largest compressed chunks are approximately 343 KB for `tradeOverlayHistory`, 193 KB for App, 96 KB for the entry, and 80 KB for TradingChart. Chunk names do not imply that all contained code belongs to that feature.

At an ideal 1.5 Mbit/sec gzip payload rate, that inventory alone takes approximately **4.33 seconds to transfer**, excluding latency, parsing, data loading and additional resources. This is a risk estimate, not measured LCP. Brotli, warm caches and faster links change the result. Investigate the largest shared chunk/module graph, CSS coverage, and guest/auth startup boundaries before setting a startup promise.

Source review identified additional pressure points:

- Tick storage permits 10,000 ticks per encountered symbol without idle-symbol eviction on unsubscribe. A per-symbol bound is not a total heap bound. The candle cache allows up to 64 x 20,000 rows before other copies.
- Aggregation batches are bounded, but the worker's pending request/callback workload has no global queue budget/deadline. Test a slow worker and high correction rate.
- Quote seed batches use `Promise.all`; cleanup can ignore obsolete results without aborting their requests. Rapid scrolling/account switching adds avoidable work.
- Six charts can each run gap repair with concurrency four. Closed-market and daily-change recovery have separate four-worker pools. A per-feature limit does not establish a per-tab/global limit.
- Primary chart reconnect backoff resets before stable readiness. Other transports have useful handshake/stable-open safeguards, but capped additive jitter can synchronize retries.

Useful controls already exist: per-frame tick coalescing/freshness deduplication, visible quote demand, shared in-flight instrument/catalog reads, ref-counted cancellation for those reads, scoped caches, chart visibility cleanup, limited history repair and many socket/session ownership checks. These reduce work but do not prove a heap plateau or acceptable responsiveness. The browser WebSocket API itself provides no receive-side backpressure. [MDN WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket).

## Session, security and operational coverage

- **Trading degradation needs two additional checks.** [`OneClickTrading.tsx`](../src/components/OneClickTrading.tsx), lines 249-290, checks positive bid/ask, symbol eligibility and market status. Eligibility comes from periodically refreshed backend feed status; it does not directly verify the browser's displayed quote timestamp/connection at click time. A browser-only feed disconnect is therefore a source-supported stale-display risk. This does not prove the backend accepts stale execution. [`services/api.ts`](../src/services/api.ts), lines 776-809, rethrows a failed REST-create response before reconciling its UUID; a lost response can be ambiguous even though the UI receives an error. By contrast, an already-sent WebSocket order is reconciled by GET using its original UUID, without a second create (lines 869-877). Test both paths with a simulated server.
- **Order rejection can dismiss its dialog.** [`App.tsx`](../src/App.tsx), lines 2694-2739, publishes failure feedback but resolves the submission callback normally; blocked submissions also return normally. [`OrderPanelDialog.tsx`](../src/components/OrderPanelDialog.tsx), lines 559-567, closes after that resolution. Feedback is still published globally, so errors are not entirely hidden. Decide and verify whether a rejected/unsent order should retain the dialog and entered values.
- **Two-tab identity requires acceptance testing.** Tokens are shared in localStorage while account/broker state is runtime-local. The storage listener validates token existence/expiry, not that a replacement token belongs to the displayed account. This is a source-supported mismatch risk, not a demonstrated wrong-account trade or authorization bypass. The backend must enforce account ownership independently.
- **Telemetry is incomplete in the inspected runtime.** Browser errors mainly go to console; no active durable exception-reporting destination was found. Electron suppresses console and uncaught error output. Existing performance hooks do not demonstrate production field collection. Record sanitized release-tagged errors, startup failures, chunk failures and connection recovery without tokens/account payloads.
- **Three high findings in the production dependency audit** belong to the Electron updater chain: `electron-updater`, `builder-util-runtime`, `js-yaml`. No browser renderer import of that chain was found. Upgrade/re-audit the desktop chain; these are not three demonstrated browser exploits. The maintainer advisories describe [cross-origin credential redirects](https://github.com/electron-userland/electron-builder/security/advisories/GHSA-p2f4-r6v6-j797) and [YAML CPU exhaustion](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh).
- **The full dependency audit reports 30 affected packages: 3 critical, 21 high, 4 moderate and 2 low**, including the preceding three high findings. Counts include propagated package findings, not 30 independent exploits. Critical entries concern the Vitest/UI test server and `tar` archive handling in desktop packaging. Additional high findings include Vite's development server and Electron itself; Electron is listed as a devDependency but ships as the desktop runtime. No additional affected package was traced into the shipped web application's browser imports. The Node build/test hosts and desktop release still need dependency updates and re-audit; npm audit does not scan nginx/Alpine images. See the detailed security evidence and the [Vitest](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp), [tar](https://github.com/isaacs/node-tar/security/advisories/GHSA-23hp-3jrh-7fpw), and [Vite](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff) maintainer advisories.
- **No confirmed XSS was found in the inspected print/export/annotation sinks.** HTML escaping, textContent, restricted annotation URLs and sandboxed preview are present. This is bounded source review, not whole-program security certification. JavaScript-readable persistent tokens increase the consequence of any future same-origin script compromise.
- **The real rollout remains unknown.** `.github/workflows/deploy.yml` is entirely commented, and historical deployment references external infrastructure. Repo metadata does not reproduce that infra. The legacy `curl /` check proves only HTTP success and lacks a request deadline; no checked-in container HEALTHCHECK validates the app.
- **Host/image controls remain unverified.** Check the actual image digest, nginx modules/OS advisories, CPU/RAM, worker/file-descriptor limits, log rotation, replicas, CDN settings and restart/readiness behavior. `nginx:1.27-alpine` needs a current image/module-specific review; no executable-container scan was available. nginx connection capacity also depends on upstream connections and process open-file limits. [nginx core documentation](https://nginx.org/en/docs/ngx_core_module.html#worker_connections).
- **Build context hygiene needs review.** `COPY . .` can include `.npmrc`, env files or scratch files not excluded by `.dockerignore`; the final image only copies `dist`, so this is a builder/cache boundary concern rather than proof of public disclosure. Use explicit public build inputs and secret mounts where registry credentials are required. [Docker build secrets](https://docs.docker.com/build/building/secrets/).

## Verification performed and limits

| Check | Result |
| --- | --- |
| Web and Electron production renderer builds from the cleanup | Passed, including TypeScript build checks; reused rather than rebuilding unchanged code. |
| Build freshness check | Web HTML built at 09:19:12 UTC; 514 production source/style/data files scanned, none newer. This is a freshness check, not deployed image provenance. |
| Fresh focused audit test run | 22/22 passed across BrokerAPI logout, auth store, guest chart data and public catalog suites. |
| Runtime override/config publication trials | Five silent-override cases and one generation/publication case reproduced using dummy data. |
| Refreshed-expiry decision | Fault reproduced from extracted current source; synchronized-state control passed. |
| Dependency audits | Production dependencies: 3 high; full build/test/desktop dependency graph: 30 affected packages, including 3 critical. Boundaries explained above; no exploit tests or automatic fixes. |
| Public delivery/CORS | Nine low-rate requests; sanitized headers, byte counts and selected routing fields retained. |
| Prior broad Vitest result | 3,990 passed / 25 failed assertions, plus an obsolete-file collection artifact; not green. See cleanup report for the investigated failure provenance and successful retry. |
| Prior directly relevant cleanup regression tests | 160 assertions passed; Docker runtime retry 11 passed; startup/preview scripts 22 passed. |
| Interactive browser validation | Not completed: Browser automation timed out, then reported no available browser. No current visual, authenticated-session or Web Vitals result is claimed. |
| Actual Docker/nginx image, staging load, soak, chaos, multi-region and authenticated trading | Not performed; no usable local container runtime or controlled staging target was available. |

Passing focused tests does not cover the discovered stale-expiry case; the new isolated reproduction explains that gap. The prior broad failures need correction or explicit justified disposition before an automated release gate can be considered clean.

## Required staging validation before declaring a traffic limit

The following is a concrete validation plan, **not executed capacity evidence**. Use synthetic accounts/data and an isolated environment reflecting the actual ingress, CDN, replicas and broker limits. Determine guest/auth mix, concurrent tabs, charts/symbols, session duration, geography, device baseline and login bursts first.

| Scenario | Workload and measurements | Acceptance |
| --- | --- | --- |
| Exact image/config smoke | Build immutable candidate, validate generated runtime fields, HTML/entry/all referenced chunks, correct broker identity, missing asset response and discovery CORS through the edge. | Every required resource/config correct; missing assets 404 + no-store; no secret-dependent public config. |
| Release with old sessions open | Keep A open, deploy B, then open never-fetched features/locales; fail candidate startup and exercise rollback. | Old sessions remain usable or recover with controlled UX; rollback demonstrated; no redirect/reload loop. |
| Session lifetime | Reactive/proactive refresh before expiry, continuously foreground session, simultaneous tab/API refresh, logout/account change during refresh. | One consistent session expiry/identity; no unexpected logout or stale-account rendering; logout cannot resurrect a session. |
| Static cold/warm delivery | Model arrival rate, not just fixed users; test CDN cache cold and warm from relevant regions. | Suggested starting SLO: error rate <0.1%, p95 <=500 ms and p99 <=1 s for selected static routes; tune to geography and product requirements. |
| Guest/API demand | 1 and 6 charts; scale realistic guest mix to target, then 1.5x-2x headroom; include large catalogs/history requests. | No growing queues or 429 retry feedback loop; agreed p95/p99 and data-age budgets met. |
| Authenticated feed fan-out | Hold modeled sockets and subscriptions at realistic ticks/sec and sizes; include multiple tabs and broker vendor limits. | Socket/FD/CPU/RAM/egress headroom demonstrated; agreed quote-age and stream-recovery SLOs met. |
| Failure/reconnect | Cut feed/API connectivity, issue 429/503, open-then-drop sockets, slow/never-completing requests, restart backend. | Bounded retries/deadlines; recovery is distributed; stale/disconnected data cannot appear tradable as fresh. |
| Trading failure UX | Simulated rejects, ambiguous order acknowledgements, disconnect at submit, account switch and duplicate click. | No duplicate create on ambiguous outcomes; clear pending/rejected state; request identity preserved and server authorization enforced. |
| Browser soak | 4-8 hours, symbols switched/scrolled, 1 and 6 charts, high ticks/corrections, hide/restore tabs and sleep/wake. | Heap/worker queue plateaus; handlers/sockets are released; no sustained main-thread stalls or silent stream loss. |
| Browser/device matrix | Current Chrome/Edge/Firefox/Safari plus declared minimum supported versions, low-end device, narrow viewport and constrained link. | No startup/interaction regressions; market/trade controls remain usable. Vite's compilation target alone is insufficient. |
| Observability and limits | Collect edge hit ratio, HTTP p95/p99/error rate, dropped test iterations, app startup/JS errors, feed age/reconnects, backend queues, FD/CPU/RAM/disk/egress. | Alerts and dashboards identify saturation and regressions; test generator has spare capacity too. |

Use explicit pass/fail thresholds and ensure an overloaded load generator is not hiding requests. k6 supports arrival-rate scenarios and threshold failures suitable for CI. [k6 load testing](https://grafana.com/docs/k6/latest/testing-guides/api-load-testing/), [thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/), [large-test constraints](https://grafana.com/docs/k6/latest/testing-guides/running-large-tests/).

For browser field performance, use **p75 LCP <=2.5 s, INP <=200 ms and CLS <=0.1**, segmented by mobile/desktop, alongside a separate terminal-data-readiness and quote-age SLO. These are established Core Web Vitals targets, not measurements from this audit. [Web Vitals](https://web.dev/articles/vitals).

Capacity is accepted only when the required workload passes on the **actual release candidate and representative infrastructure**, including recovery and soak. Frontend build size, daily users, or one successful endpoint response alone cannot certify it.

## Evidence and reproducibility

Sanitized evidence and detailed source findings: [`artifacts/production-readiness-20260921/`](../artifacts/production-readiness-20260921/). The original temporary work directory is `C:/Users/ADMIN/AppData/Local/Temp/rtx-production-audit-20260921/`.

- `audit-summary.json`: build freshness, focused-test totals and provisional capacity arithmetic.
- `delivery-evidence.json`, `served-negative-cache-recheck.json`, `public-api-evidence.json`: timestamped public delivery and CORS evidence. No live token values or account payloads retained.
- `runtime-override-results.json`, `runtime-generation-results.json`: dummy configuration proofs, including documented tooling timeouts.
- `refresh-expiry-source-proof.json`: source hashes, failing synthetic expiry state and passing control.
- `reproduce-runtime-overrides.cjs`, `reproduce-runtime-generation.cjs`, `reproduce-refresh-expiry.cjs`: isolated reproduction scripts; run from repository root. Runtime scripts write only temporary fixtures; the expiry script accepts the repo path as its first argument.
- `focused-tests.json`, dependency audit JSON, and detailed deployment/runtime/security notes provide the underlying results and exact source line references.

No production change is included in this audit. The first implementation priorities are runtime/discovery correctness, consistent session refresh, release asset/cache behavior and reconnect/polling control; then execute the workload-specific release gates above.
