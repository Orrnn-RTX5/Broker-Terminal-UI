# Web terminal startup investigation — 2026-09-21

The sub-second fully populated terminal target has **not** been achieved. The application has avoidable startup work, a large first-view JavaScript graph, and highly variable required broker API responses. Showing the static loading screen is not counted as terminal readiness. The latest implementation and measurements are in [Worker batching and render follow-up (pass 7)](#worker-batching-and-render-follow-up-pass-7). Earlier samples remain as historical evidence; guest and authenticated measurements have different scopes.

## What was measured

Production Vite web builds served locally with gzip level 6 and immutable asset caching, matching the relevant nginx settings. Each sample uses a unique asset URL prefix to force uncached application JS/CSS without clearing the user's browser data. Public data comes from the configured Nexa broker. The workspace readiness boundary still waits for initial data, Market Watch, and the chart.

The initial samples below are guest-terminal tests in an existing Chrome session. Browser storage, DNS, TLS connections, and server caches were not reset. This is not a deployed-site measurement or proof of a completely new visitor's cold connection. At that stage no deployed terminal URL had been supplied, and authenticated production restore had not been measured; subsequent sections record additional checks. Builds/tests were stopped during those browser samples. Earlier CLI endpoint samples overlapped local memory pressure; free RAM initially fell to 0.39 GB out of 7.92 GB, later recovering above 1.8 GB. That can affect timings, but does not explain the observed absence of main-thread long tasks during the longest API stalls.

## Baseline and first optimization trial

All values are milliseconds from navigation. Samples are observations, not an SLA or a controlled percentage speedup.

| Sample | Loading screen FCP | Workspace mounted (still hidden) | Full terminal ready |
| --- | ---: | ---: | ---: |
| Baseline A | 192.0 | 989.0 | 11960.9 |
| Baseline B | 340.0 | 1226.9 | 4146.9 |
| Baseline C | 320.0 | 1314.9 | 2678.8 |
| Optimized trial A | 248.0 | 1263.3 | 1996.3 |
| Optimized trial B | 316.0 | 1194.8 | 20930.1 |
| Optimized trial C | 356.0 | 1442.9 | 2936.8 |

The 20.93-second trial is retained: its symbols request took 19855.4 ms and its first 500-candle request took 18983.1 ms. Across that entire startup, measured long tasks totaled 706 ms; the largest was 273 ms. Browser resource timing cannot separate the remote network, proxy, and backend processing portions because the broker does not expose detailed cross-origin timing. These values measure complete API resource round trips, not just database/handler execution.

Trial C exposed an additional race: a fast speculative catalog response completed before App mounted and was discarded, causing a second request. The final code now hands that exact public startup result to the first catalog/quote consumers once, for at most 1000 ms after completion. Original upstream quote timestamps are retained; subsequent polling requests fresh data. Final-build samples are recorded below.

## Causes and measured costs

- The first-view static module closure was 2,699,333 bytes of JavaScript (796,003 bytes gzip), plus approximately 575,800 bytes CSS (86,900 gzip), before locale chunks. The browser downloaded/parses approximately 3.03 MB JS before readiness when the unnecessary screenshot renderer was included. This remains a substantial local parse/render cost, even with a fast network.
- App/chart downloads originally started only after the entry and React loader ran. The production HTML now preloads the exact generated first-view module/CSS graph. Optional dynamic dialogs remain outside that preload traversal.
- Catalog display and guest quote hooks requested the same public catalog independently. They now share a broker-URL-scoped request and the bounded startup handoff. Each consumer has independent cancellation; private authorization stays separate.
- Closed Open Account dialogs fetched broker directories. Navigator/title effects repeated broker-list requests, desktop-release lookup contacted GitHub, and screenshot initialization downloaded html2canvas before a capture. These competed with the first view. The closed dialog no longer prefetches; title/logo/release requests wait for actual terminal readiness and a paint; screenshot rendering loads on the first capture.
- Removing screenshot preloading saved approximately 230 KB raw JavaScript / 57 KB compressed from the measured startup network path. Observed asset transfer fell from 971,582 to 914,182 bytes in the first optimization trial (including local locale/CSS/asset response headers).
- nginx already enables gzip and long-lived hashed-asset caching. Fonts are bundled locally; no Google Fonts request is required. Runtime configuration was a same-origin, uncached, parser-blocking request during this baseline, preserving the deployment's broker selection. Pass 6 now inlines that configuration during container startup. None of these facts prove the public hosting/CDN configuration is correct.

## Independent broker endpoint measurements

Three fresh curl processes/connections per endpoint; seconds shown below. No credentials or cookies used.

| Endpoint | Sample 1 | Sample 2 | Sample 3 | Median |
| --- | ---: | ---: | ---: | ---: |
| Public symbols | 1.623 | 3.228 | 2.072 | 2.072 |
| Feed status | 0.878 | 1.976 | 2.734 | 1.976 |
| BTCUSD M1, 500 candles | 2.006 | 1.111 | 2.978 | 2.006 |

For the candle samples, DNS took 8.2–57.3 ms, TCP establishment 58.9–59.7 ms, TLS 141.7–158.8 ms, waiting after TLS for the first response byte 818.4–2525.0 ms, and body transfer 66.2–242.0 ms. Response wait includes the network path and upstream server; backend tracing is needed to separate them. Full samples and cumulative definitions are in the JSON evidence.

A trial on port 5181 failed because the broker omitted Access-Control-Allow-Origin for that origin. It is excluded from successful timing comparisons; the broker allowed port 5174. An error-state shell is not a successful market-data load.

## Preserved behavior and remaining work

No readiness gate was removed, no fixed delay was substituted for real readiness, and no fake prices or account permissions were introduced. Chart history count, live quote timestamps, authentication/session guards, chart controls, and appearance are preserved. Optional release/title/logo information arrives after the initial terminal paint.

A reliable sub-second target needs both a smaller/faster first-view execution path and predictable low-latency broker responses. The measured request stalls cannot be eliminated by a frontend timer or a static nginx cache directive. The public deployment URL and broker/CDN/backend traces are needed to verify and fix the remaining production path. Backend response caching, if introduced there, must preserve broker identity and quote timestamps and must not cache private account responses or label stale prices as live.

## Validation and reproduction

140 unique focused tests passed across startup gates, HTML/preload output, catalog ownership/freshness/cancellation, login handoff, dialogs, release metadata and screenshots. The production web build passed TypeScript and Vite. Browser inspection verified a populated BTCUSD M1 chart, Market Watch, toolbar, drawing controls and Toolbox; no trades were submitted.

Run a production build, then:

```powershell
node scripts/profile-web-startup.mjs artifacts/web-startup-profile-20260921/optimized-build 5174 sample_a
```

Open the local page with a new startup-sample query value per asset-cold sample. The profiler publishes sanitized data in the rtx-startup-profile JSON element and never captures account tokens, request headers, or arbitrary query strings. Only public candle limit/timeframe parameters are retained.

Evidence: ../artifacts/web-startup-profile-20260921/ contains individual browser profiles, comparison.json, bundle-profile-baseline.json and optimized-terminal.png. Independent endpoint samples: ../artifacts/startup-performance/nexa-endpoint-timings.json.

## Final build samples

The final build passed TypeScript and Vite (2460 modules; Vite phase 19.61 s). Three additional fresh-asset samples after the handoff fix:

| Sample | Loading screen FCP | Workspace mounted | Chart ready | Catalog/account data ready | Full terminal ready | Long-task total / max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Final A | 120.0 | 4538.7 | 6261.7 | 5052.5 | 6333.7 | 4740 / 1669 |
| Final B | 264.0 | 1366.6 | 44852.3 | 3712.6 | 45088.4 | 1276 / 397 |
| Final C | 304.0 | 862.8 | 3191.3 | 30070.6 | 30175.0 | 753 / 249 |

All values are milliseconds. The first initial public catalog was shared once in each final sample; later 3-second polls are separate. Final A included two large browser long tasks of 1669 and 1618 ms. Final B's first 500-candle request took **40952.4 ms**; Final C's catalog request took **29551.2 ms**. The final UI was checked to contain actual Market Watch prices and the BTCUSD chart. The ready metric by itself can also describe an error state, so it must always be paired with that content check.

A subsequent curl check with the same allowed Origin returned HTTP 200 for 500 candles in **828.403 ms** (DNS 8.136, cumulative TCP 70.358, cumulative TLS 272.470, cumulative TTFB 756.352 ms). It was not simultaneous with the stalled browser request and used a different client/connection. It demonstrates variability; it does **not** isolate the browser/network/proxy/backend cause. Do not attribute the 40-second resource wait solely to backend handler execution without transport and server traces.

**Acceptance result: below one second failed.** The frontend fixes are verified, but the final sample range is 6.334–45.088 s on this machine/network. Earlier trial best was 1.996 s; it must not be presented as the final build's guaranteed performance. The changed workload and large variance do not support a claimed percentage speedup.

## Second optimization pass — INTERMEDIATE authenticated measurements

This section records **an existing AUTHENTICATED Chrome session**, restored against the configured Nexa broker with fresh application asset URLs. It extends the earlier report without replacing its guest measurements. The authenticated restore, account data and trade streams create a different workload; **the earlier guest results are not a comparable authenticated baseline**. These local production-build samples are not deployment measurements or completely cold browser/network sessions.

Pass 2 A is the authenticated reference for the next changes. Pass 3 A/B/C are **INTERMEDIATE**, preceding the final correction that starts authenticated history transport synchronously after session validation, before React's store-update render. Pass 4 build and browser results must be recorded separately; the values below do not validate that final correction.

All timing values below are milliseconds from navigation. Long-task totals include the recorded tasks that started before full terminal readiness; they are main-thread task durations, not process-wide CPU utilization.

| Authenticated sample | Loading screen FCP | Workspace mounted | Data ready | Chart ready | Full terminal ready | Long tasks: count / total / maximum |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Pass 2 A | 328.0 | 2585.7 | 4160.7 | 5387.8 | 5552.6 | 16 / 2263 / 438 |
| Pass 3 A — intermediate | 304.0 | 2685.2 | 3384.3 | 4582.1 | 5188.1 | 13 / 2815 / 1219 |
| Pass 3 B — intermediate | 372.0 | 5714.8 | 6874.2 | 7985.3 | 8298.2 | 15 / 5288 / 1638 |
| Pass 3 C — intermediate | 328.0 | 3804.9 | 5420.2 | 6615.7 | 6871.6 | 26 / 4396 / 976 |

These observations do **not** establish an overall startup speedup: two of the three pass 3 samples took longer than pass 2 A, and all exceeded one second. Both required broker round trips and local main-thread work remain material.

### Verified reductions in startup requests

Counts below are completed resource entries whose requests **started before terminal readiness**. A response can therefore finish after readiness. The captures lasted 30137.0 ms for pass 2 A and 7196.6 / 30210.6 / 9294.9 ms for pass 3 A/B/C; the table uses the startup interval rather than comparing those unequal whole-capture durations.

| Request | Pass 2 A | Pass 3 A | Pass 3 B | Pass 3 C |
| --- | ---: | ---: | ---: | ---: |
| `/api/v2/instruments` | 3 | 1 | 1 | 1 |
| `/api/v2/orders/pending/[id]` | 3 | 1 | 1 | 1 |
| `/api/v2/positions/[id]/history?limit=500` | 3 | 1 | 1 | 1 |
| `/api/v2/deals/[id]?limit=500` | 3 | 1 | 1 | 1 |
| `/api/v2/broker/config` | 1 | 0 | 0 | 0 |
| `/api/v2/broker/servers` | 1 | 0 | 0 | 0 |
| `/api/v2/brokers` | 1 | 0 | 0 | 0 |
| `/api/v2/positions/[id]?limit=50` | 2 | 3 | 2 | 2 |

Market Watch, MenuBar and FileMenu now share a concurrent authorized catalog read. Sharing is limited to the exact committed broker/account, effective URL, access token, refresh inputs and request deadline. Each consumer can cancel independently; all-consumer cancellation aborts the transport, session changes clear joining eligibility, and settled results are immediately evicted. Existing symbol permissions and API authentication recovery remain in force.

Trade-stream subscription acknowledgements and other explicit control frames no longer masquerade as order/deal changes that trigger repeated pending-order/history/deal REST rounds. Actual trade changes retain their refresh path. The measured three-to-one reduction is specific to those endpoints; open-position refreshes were intentionally not given a general response cache, and their remaining requests are shown above.

Optional broker configuration, directory, title/logo and release work was moved behind actual terminal readiness and a paint, and closed dialogs no longer initiate discovery. The three optional broker requests observed during pass 2 startup were absent from each pass 3 startup interval. This removes their competition with required startup work; it does not remove broker selection or dialog behavior when those features are used.

### Smaller initial module graph and bounded startup handoffs

Welcome content, closed settings/login/account/symbol/print dialogs, and optional panels now load when needed. Screenshot rendering continues to load on the first capture. Generated HTML preloads the terminal's required module/CSS graph; optional feature chunks remain outside that traversal.

| Static JavaScript closure of entry + App + TradingChart | Original bundle baseline | Pass 3 | Reduction |
| --- | ---: | ---: | ---: |
| Raw bytes | 2699333 | 2467692 | 231641 |
| Gzip bytes | 796003 | 740310 | 55693 |
| Brotli bytes | 662404 | 621178 | 41226 |

These are build-analyzer byte counts, not observed transfer totals or a claimed loading-time improvement. CSS and additional locale requests are outside these JavaScript totals. The remaining initial JavaScript closure is still approximately 2.47 MB raw.

The account summary that successfully validates a restored session can seed the initial account snapshot once, for at most one second, under that committed broker/account and the current access token. Returned account identities must agree. Positions still load fresh, and later account refreshes remain permitted. The recorded restore account request appeared once in pass 2 A and pass 3 B/C; pass 3 A also contained a later account refresh, so the implementation does not promise one account request for the entire session.

Public catalog startup consumers share an in-flight request or one completed handoff lasting at most one second. Original quote timestamps remain unchanged. A slow authenticated restore can outlive that handoff and correctly require fresh public data: pass 3 A recorded one public catalog request, while B/C recorded two. There is no persistent quote cache.

Guest history prefetch starts the exact default BTCUSD M1 500-candle request while App loads, only when no stored access or refresh token is present; it sends no account credentials. Authenticated history prefetch runs only after restore validates and commits the session, and its one-use handoff is scoped to that session/token/generation. Both paths preserve candle timestamps, require valid nonempty history before reporting consumption, and retain the normal fetch fallback and cancellation/session checks. Live updates received around the prefetch handoff retain precedence when chart history merges. **Guest history prefetch is not an explanation for these authenticated results.**

Pass 3 still exposed a scheduling gap before the authenticated 500-candle transport began:

| Authenticated sample | Restore account request duration | Restore account response end | First 500-candle request start | Response-end-to-history-start gap | 500-candle request duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| Pass 2 A | 836.3 | 2198.1 | 3045.5 | 847.4 | 2273.5 |
| Pass 3 A | 546.3 | 1941.1 | 2684.8 | 743.7 | 1007.5 |
| Pass 3 B | 2449.6 | 4834.6 | 5714.1 | 879.5 | 1207.2 |
| Pass 3 C | 961.0 | 2919.6 | 3804.4 | 884.8 | 2548.9 |

The gap is an observation between resource events, not solely the cost of one function. In pass 3, each history request began immediately before the recorded workspace mount instead of overlapping most of the initial render. The subsequent synchronous transport-start correction specifically targets that avoidable scheduling delay; its effect requires the separate pass 4 measurement. Broker durations still vary, and cross-origin resource timing does not separate server execution from transport delay.

### Pass 3 C: script work and forced layout

The pass 3 C profile additionally recorded 26 long animation frames before readiness. Their script entries totaled **3895.4 ms**, including **463.8 ms of forced style/layout**. Forced style/layout is a subset of script duration; these figures must not be added together. They also do not represent all browser layout work or total process CPU time. Attribution identifies the script entry point and can include downstream React work, rather than proving every millisecond belongs exclusively to the named module.

| Attributed script chunk | Script duration | Forced style/layout within it |
| --- | ---: | ---: |
| Entry `index` | 1538.1 | 40.2 |
| `loginTransportRuntime` | 1387.5 | 175.8 |
| `tradeOverlayHistory` | 424.4 | 112.2 |
| `TradingChart` | 370.4 | 135.6 |
| `App` | 113.0 | 0.0 |
| `useAppStore` | 43.1 | 0.0 |

Those six chunks account for 3876.5 ms; the remaining 18.9 ms is the page's classic script. The largest attributed callback was a `loginTransportRuntime` promise continuation starting at 2923.0 ms: **976.5 ms**, including **152.7 ms** of forced style/layout. An entry-chunk event listener starting at 4115.8 ms took **733.5 ms**, including **26.0 ms** of forced style/layout. These observations establish substantial local script/render work alongside the API waits; they do not support assigning all startup delay to either the backend or layout alone.

Evidence for this intermediate section: [pass2-auth-a.json](../artifacts/web-startup-profile-20260921/pass2-auth-a.json), [pass3-auth-a.json](../artifacts/web-startup-profile-20260921/pass3-auth-a.json), [pass3-auth-b.json](../artifacts/web-startup-profile-20260921/pass3-auth-b.json), [pass3-auth-c.json](../artifacts/web-startup-profile-20260921/pass3-auth-c.json), [bundle-profile-baseline.json](../artifacts/web-startup-profile-20260921/bundle-profile-baseline.json), and [bundle-profile-pass3.json](../artifacts/web-startup-profile-20260921/bundle-profile-pass3.json). Profiles contain sanitized account paths rather than account IDs or request credentials. **The sub-second fully populated terminal target remains unproven and was not achieved in any of these samples.**

## Final authenticated build (pass 4)

The final change starts speculative history transport synchronously after the restored session is validated and committed. Previously, a promise microtask queued transport behind React's store-update work. The new ordering overlaps the request with workspace mounting. Both public and authenticated handoffs remain single-consumer, preserve upstream timestamps, expire unused completed results after one second, and transfer cancellation ownership to the chart. Session generations prevent a request from surviving an account switch away and back; session-change rejection does not retry under another account's credentials. No readiness requirement was removed.

The user's open terminal was the Vite development server at `http://127.0.0.1:5173/`. These measurements instead use the final optimized production build at port 5174 with the existing authenticated session, local gzip hosting, and live Nexa APIs. Each sample used fresh asset URLs. They are not measurements of deployed hosting or entirely fresh browser/network state. The local machine had approximately 2.45 GiB free physical memory during final sampling; no build or test was running. Browser visibility remained visible in the saved profiles.

All values below are milliseconds from navigation, except long-task totals/durations.

| Final sample | Loading screen FCP | Workspace mounted | Data ready | Chart ready | Full terminal ready after paint | Long-task total / max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 132.0 | 2247.1 | 3027.3 | 4407.1 | **5366.6** | 1454 / 521 |
| B | 272.0 | 1984.5 | 2713.7 | 2670.5 | **2801.7** | 1199 / 976 |
| C | 408.0 | 2650.2 | 3291.0 | 14341.1 | **14482.4** | 1215 / 458 |

The best result was 2.802 s; the median was 5.367 s. The 14.482 s outlier is retained. These variable observations do not support an overall percentage speedup or a sub-second guarantee.

| Request | A start / duration | B start / duration | C start / duration |
| --- | ---: | ---: | ---: |
| Initial public catalog | 277.0 / 1215.0 | 370.9 / 725.6 | 664.1 / 724.8 |
| Restore account validation | 556.1 / 1274.0 | 721.6 / 557.3 | 1695.3 / 599.8 |
| Authorized instruments | 2059.3 / 396.8 | 1885.9 / 511.1 | 2462.6 / 547.1 |
| Initial positions snapshot | 2264.9 / 713.7 | 2036.3 / 544.3 | 2670.0 / 571.9 |
| Recorded successful BTCUSD M1 / 500 candles | 1869.9 / 1328.1 | 1325.8 / 1201.5 | 13464.8 / 803.0 |

The history request in A starts **377.2 ms before** workspace mounting; in B it starts **658.7 ms before** mounting. This verifies the intended overlap. C has a long gap before its recorded successful history request; Resource Timing does not fully explain the earlier history attempt or its recovery. Do not attribute that entire gap to a backend handler, a fixed frontend timer, or token rotation without an instrumented request lifecycle/server trace. Its successful request alone took 803.0 ms. Cross-origin timing still provides total request duration rather than a trustworthy DNS/TLS/server-processing breakdown.

All three final samples contain **one authorized instruments request** and **one initial pending-orders/history/deals round** before readiness. Optional broker config/server/directory requests are absent from that critical path. Account/position refreshes later in startup still occur; they were not globally cached because post-trade reads must remain fresh. A public catalog preload may expire during a slow restore and then be refreshed; the code deliberately does not extend quote freshness to conceal that delay.

The final first-view static JavaScript closure is **2,467,653 bytes / 740,309 bytes gzip**, versus **2,699,333 / 796,003** in the original bundle profile: a deterministic reduction of **231,680 raw bytes (8.58%) / 55,694 gzip bytes (7.00%)**. Locale requests and CSS are additional. Earlier screenshot-renderer removal saved a further approximately 57 KB compressed from the observed network path; it was never in that static closure. The App chunk is now 679,451 bytes. Large chart/drawing/runtime chunks remain.

Validation: the final TypeScript build and production Vite build passed. Focused checks covered lazy-feature state retention and close-during-load behavior, first-login/desktop entry behavior, instrument request sharing and independent cancellation, account-summary handoff, enabled catalog consumers, websocket control admission, first-viewport history ownership and freshness, per-selection live-candle merging, preload output, and the existing readiness boundary. The last history ordering/cancellation test run passed **35 tests across 3 files**; earlier focused runs are described above and should not be added together without deduplicating repeated files. `node --check scripts/profile-web-startup.mjs` passed.

Browser inspection verified populated Market Watch, BTCUSD M1 candles, the existing position and account summary, drawing controls and Toolbox. The deferred Print Setup dialog downloaded and opened successfully and was cancelled without saving. No orders were placed or closed. The final screenshot is [final-authenticated-terminal.png](../artifacts/web-startup-profile-20260921/final-authenticated-terminal.png).

Final evidence: [summary](../artifacts/web-startup-profile-20260921/final-auth-summary.json), [sample A](../artifacts/web-startup-profile-20260921/pass4-auth-a.json), [sample B](../artifacts/web-startup-profile-20260921/pass4-auth-b.json), [sample C](../artifacts/web-startup-profile-20260921/pass4-auth-c.json), [bundle profile](../artifacts/web-startup-profile-20260921/bundle-profile-pass4.json). The profiler now captures a larger Resource Timing buffer and supported Long Animation Frame script/layout attribution, without headers, tokens, response bodies, or arbitrary query strings.

To reproduce against this exact final build:

```powershell
node scripts/profile-web-startup.mjs artifacts/web-startup-profile-20260921/pass4-build 5174 new_sample
```

Open `http://127.0.0.1:5174/?startup-sample=new_sample` and use a different sample name for fresh application assets. This is a local profiling server, not a deployed production service.

**Acceptance: below one second is still not achieved.** The remaining work includes initial browser execution/rendering and the broker request path, including tracing the slow history recovery. The Nexa backend repository/server configuration was requested but was not supplied during this run. No remote deployment was performed.

## Docker and deployed delivery audit

The Dockerfile builds the web bundle in a Node build stage and copies only `dist` into the final nginx image. Browser visits do not run npm, Vite, or an application build. The custom entrypoint runs once when the container starts; it either preserves the built runtime config or generates it from explicit deployment settings using local shell operations. It contains no network discovery, API wait, or sleep. This rules out per-visit rebuilding in the checked configuration; it does not measure the deployed container's CPU, disk, or network overhead.

Docker is unavailable on this workstation, so no image build, container startup measurement, or live container nginx validation was possible. The terminal at `http://127.0.0.1:5173/` serves `/@vite/client` and `/src/main.tsx`: it is Vite, not Docker. The local production profiling results above also used a separate Node static server, not a container.

### The checked public site does not contain the latest local changes

The Nexa entry in the repository's broker-directory snapshot identifies `https://nexa-terminal.orrnn.com/`. Public requests to that site confirmed its served runtime routing selects Nexa and `https://nexa.orrnn.com`. This identifies the site checked; the user has not yet confirmed it is the URL where they observe the delay.

| Evidence | Public Nexa site | Final local production build |
| --- | --- | --- |
| Entry script | `index-BsL5QfHL.js` | `index--kITIRHQ.js` |
| Critical App/chart preload added in this work | Absent | Present |
| Terminal-ready timing publisher added in this work | Absent | Present |
| App chunk | `App-DQrguylo.js`, 907225 decoded bytes | `App-DwfShYcC.js`, 679451 bytes |

The public HTML and entry script report `Last-Modified: Sat, 19 Sep 2026 11:54:42 GMT`. This is a file modification timestamp, not proof of deployment time. The missing startup code confirms that the latest local optimizations are not present on this site. The hash difference alone would not establish that conclusion.

All lines of `.github/workflows/deploy.yml` are currently commented out. Therefore that checked-in workflow does not deploy local changes or pushes. Its commented configuration refers to a separate infrastructure repository. The deployment script defaults `MANAGE_NGINX_ON_DEPLOY` to `false` and says infrastructure owns host nginx. The runtime container's `nginx.conf` is not necessarily the configuration controlling the public proxy or CDN.

### Measured public file delivery

These are unauthenticated curl requests from this workstation, each on a fresh connection, on 2026-09-21. They measure DNS/connection/TLS, CDN/proxy/origin response wait, and file transfer together. They are not a browser waterfall, Docker-only timings, or backend handler timings. Do not add the individual request durations to estimate page load: browsers can reuse connections and download concurrently. This curl installation supports HTTP/1.1 only; the measurements do not establish which protocol a browser negotiates with the site.

| Public resource | Total request time, ms | Decoded bytes | Observed delivery |
| --- | ---: | ---: | --- |
| HTML | 604.8 | 17035 | gzip; `no-store`; Cloudflare `DYNAMIC` |
| Runtime config, two samples | 890.7 / 1098.0 | 845 | gzip; `no-store`; Cloudflare `BYPASS` |
| Entry JavaScript, two samples | 1708.4 / 3443.6 | 339180 | gzip; one-year immutable; Cloudflare `MISS` |
| App JavaScript | 1689.0 | 907225 | gzip; one-year immutable; Cloudflare `MISS` |
| Chart JavaScript | 1014.1 | 262880 | gzip; one-year immutable; Cloudflare `MISS` |

An earlier standalone HTML probe took 854.5 ms; the table uses the saved JSON sample. Runtime config is a parser-blocking script in the page, so it remains a startup dependency despite its tiny size. Its uncached policy preserves deployment/broker freshness and was not relaxed. Hashed JavaScript already has compression and immutable browser caching. Repeated observed `MISS` responses warrant checking CDN cache behavior, but these samples alone do not prove caching is disabled or broken.

The public response identifies Cloudflare. Repository deployment code describes a host nginx proxy to a loopback container port, but public response headers do not prove the origin currently uses that exact topology. To isolate Docker, compare the same static resource inside the running container, through its host loopback port, through host TLS, and through the public CDN; collect host resource use and nginx request/upstream times alongside those requests. No access to that running server was available in this investigation.

### Build-context correction and validation

The current local build-context scan found approximately 1851777264 bytes of candidate files, including **1746573780 bytes of generated `artifacts`**. `.dockerignore` now excludes that directory, eliminating about **1.75 GB (94.3%)** of candidate context payload in this checkout. Docker's actual transferred bytes and build-time saving were not measured. This prevents generated profiling output from entering the build context and invalidating the source-copy layer; it does not reduce the final image by that amount, because the multi-stage image already copies only `dist`, and it does not speed up browser visits by itself.

At this earlier Docker-audit stage, the runtime-config tests passed: **2 tests**, covering preservation of the built broker config and explicit deployment overrides with the desktop guard. The expanded pass 6 validation is recorded below. These shell tests are not container performance tests. No deployment, host nginx edit, CDN edit, or readiness-gate change was performed.

Evidence: [public requests and build comparison](../artifacts/docker-loading-audit-20260921/deployed-http.json), [local Vite HTTP checks](../artifacts/docker-loading-audit-20260921/local-http-timings.json). The next deployment must include the current frontend build before its changes can be assessed on the public site. **Docker-specific overhead remains unmeasured, and sub-second full terminal readiness remains unmet.**

## Follow-up implementation and final measurements (pass 6)

**Implemented and tested locally; not deployed. Full terminal readiness below one second is still not achieved.** The earlier pass 4 section describes the previous build. Pass 6 includes the additional changes below. Its browser timing samples are guest sessions, so they must not be compared directly with the authenticated pass 4 results as an end-to-end speedup.

### Completed changes

- Container startup now embeds deployment-specific runtime configuration in the HTML. The original build template stays outside the served directory, and safe generation/validation finishes before nginx starts. Both relative and root-relative runtime script paths are supported. The compatibility `runtime-config.js` endpoint remains. The actual pass 6 build was processed through the entrypoint: evaluated configuration and standalone configuration bytes were preserved, with one inline script and zero external runtime script references. HTML freshness and broker routing were preserved. See [container rollout requirements](deploy-web-terminal.md#container-startup-configuration).
- Tick batch processing previously copied a growing symbol lookup for each new symbol. It now copies the original lookup once per batch and updates that owned copy. Tests preserve prior snapshots, freshness, symbol aliases and one publication per batch. A microbenchmark of the actual reducer and helpers, using 701 unsuffixed symbols, measured a median **67.908 ms before / 1.723 ms after**; the mixed-suffix fixture measured **99.429 / 1.825 ms**, with equivalent outputs. This is a reducer benchmark, excluding React, subscribers, persistence, network and whole-page startup. [Raw benchmark](../artifacts/web-startup-profile-20260921/tick-lookup-benchmark.json).
- Toolbox commands, Exposure content and Symbol Specification mount on first use and retain their state afterward. The active Trade view still mounts normally. Browser checks verified the deferred views and symbol dialog open successfully.
- Automatic deeper history and other-timeframe cache warming now wait for the terminal's first readiness paint, with cancellation tied to the owning history request. Required initial history and user-requested older history keep their existing behavior. The 5000-candle request started after full readiness in every final sample that captured post-ready requests. No readiness condition or trading-data freshness rule was removed.
- A separate backend checkout now contains request-context propagation for authentication and bounded server timing instrumentation. Cancellation does not become a false invalid-credentials response. This is a locally tested diagnostics/cancellation correction, not proof of faster live API responses. The [backend report and portable patch](backend-startup-2026-09-21.md) explain its scope and deployment requirements.

The first-view static JavaScript graph is **2,455,131 raw bytes / 736,696 gzip bytes**, a reduction of **12,522 / 3,613 bytes** from pass 4. This is modest; substantial chart/runtime code remains on the initial path. Locale requests and CSS are additional. [Final bundle profile](../artifacts/web-startup-profile-20260921/bundle-profile-pass6.json).

### Final browser measurements

These samples used the pass 6 production build, local gzip hosting at `http://127.0.0.1:5175/`, and live Nexa APIs. First-open samples use fresh application asset URLs; they do not reset all DNS, TLS, operating-system or browser state. Refresh samples are actual browser reloads (`navigation.type = reload`). The user's existing development tabs remained open. No build or test from this task ran during these final samples. The roughly 8 GiB workstation had about 1.11 GiB free physical memory when sample A was inspected and 1.81 GiB after the last sample. This is not a controlled hardware benchmark or a measurement of the deployed Docker/CDN path.

All values are milliseconds from navigation unless noted. Loading-screen FCP is not full terminal readiness.

| Final sample | Loading-screen FCP | Workspace mounted | Data ready | Chart ready | Full terminal ready after paint | Long-task total / max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| First open A | 468 | 2567.0 | 3304.2 | 4569.3 | **4702.3** | 2553 / 716 |
| First open B | 228 | 1739.2 | 1949.7 | 2215.1 | **2436.7** | 1249 / 604 |
| Refresh A | 220 | 6148.2 | 8284.0 | 10171.8 | **10308.3** | 8381 / 2592 |
| Refresh B | 292 | 1123.1 | 1416.6 | 1494.4 | **1801.3** | 1128 / 414 |

All four samples made **zero external runtime-config requests**. Refresh A's application scripts/styles were cached, yet the page still recorded 8.381 seconds inside long tasks. Its initial 500-candle response finished at 1278.7 ms, well before the workspace mounted at 6148.2 ms. That directly demonstrates substantial browser-side delay even when downloads are cached. Long-task durations are wall-clock observations, not exclusive CPU attribution or proof that the application alone caused all scheduling pressure.

Direct inspection of the built functions attributes its 2054 ms animation callback to `liveTickDispatcher` flushing both stores and their synchronous subscribers. The 2592 ms entry-chunk callback is React Scheduler's `performWorkUntilDeadline`, including 247 ms forced style/layout; it does not identify an individual React component. The earlier 2031 ms task has no script attribution. The initial full catalog also generates many worker messages and separate worker-result store commits, but their contribution to these measured callbacks has not been isolated. Reducing those notifications is a follow-up profiling candidate, not an established cause or a validated fix in this change.

| Request / phase | First open A | First open B | Refresh A | Refresh B |
| --- | ---: | ---: | ---: | ---: |
| Initial symbol catalog duration | 899.6 | 733.3 | 685.4 | 571.5 |
| Initial 500-candle duration | 1061.7 | 958.9 | 723.2 | 673.9 |
| Additional initial 500-candle request | 1153.4 | None | 1767.2 | None |
| Automatic 5000-candle request start | Not captured after ready | 2576.8 | 10496.1 | 1935.1 |

The extra initial history request in slow samples follows expiry of the existing one-second speculative handoff while the chart is still mounting. That freshness rule was preserved. Request durations overlap browser work and must not be added to produce a page-load estimate. Live cross-origin responses still do not expose the new timing headers, because the backend patch has not been deployed; DNS, transport, gateway processing and history-service work therefore cannot yet be separated reliably in these browser samples.

For context, guest pass 4 samples after toolchain installation completed measured **3096.5 ms first open / 2306.8 ms refresh**. An earlier exploratory pass 4 refresh reached 27695.5 ms while toolchain extraction was competing for resources; its artifact is retained but excluded from comparison. The variable final results do not establish a reliable end-to-end speedup. The **10.308-second final refresh outlier is retained**; the best 1.801-second refresh does not represent consistent performance.

Evidence: [final summary](../artifacts/web-startup-profile-20260921/pass6-final-summary.json), [first open A](../artifacts/web-startup-profile-20260921/pass6-guest-cold-a.json), [first open B](../artifacts/web-startup-profile-20260921/pass6-guest-cold-b.json), [refresh A](../artifacts/web-startup-profile-20260921/pass6-guest-refresh.json), [refresh B](../artifacts/web-startup-profile-20260921/pass6-guest-refresh-b.json), [populated guest terminal screenshot](../artifacts/web-startup-profile-20260921/pass6-guest-terminal.png), [container inlining verification](../artifacts/web-startup-profile-20260921/pass6-container-inlining-verification.json).

### Validation and remaining deployment dependency

TypeScript and the final production build passed. Focused frontend checks passed: **59** Market Watch/lazy-feature tests, **45** dock/live-tick tests, **15** Docker/Electron runtime-config tests, and **85** chart-history/readiness tests. The backend's **24 unique top-level focused tests** also passed. Docker shell integration was checked with Git Bash and awk; Docker itself is unavailable, so an Alpine image build/start remains unverified. Existing Vite large-chunk warnings remain.

The final guest browser view displayed real BTCUSD M1 candles and populated Market Watch. A separate existing authenticated session on port 5174 also reached data/chart/Market Watch readiness with its position and account summary present. That was a Vite functional check, **not authenticated production timing**. No orders were placed or closed. [Authenticated functional check](../artifacts/web-startup-profile-20260921/pass6-authenticated-dev-check.json).

No frontend or backend was pushed or deployed. The frontend workflow is disabled, and the discovered backend deployment registry contains only the `orrnn` canary, not Nexa. No authenticated Nexa host/deployment connection was available. Completing rollout requires the active Nexa deployment route/host and its actual runtime baseline; deploying the different canary would not update Nexa. After rollout, compare container loopback, host proxy and public CDN timings, then capture authenticated first-open and refresh profiles with the new backend timing headers. Browser startup work and API latency both still need to fit inside the one-second budget; these changes do not establish that result.

## Worker batching and render follow-up (pass 7)

**Implemented and tested locally; not deployed. The latest browser samples are slower than the earlier baseline. An end-to-end improvement and the one-second target have not been demonstrated.**

### Changes and deterministic checks

- Initial quote aggregation previously sent four messages per symbol and published a separate market-store update for each symbol's completed aggregation. The worker now processes bounded batches of at most 64 symbols or 10,000 ticks, sorting each symbol's ticks once for its four existing local timeframes. Current quotes still publish immediately. For the same 701-symbol fixture, requests/replies fall from **2,804 to 11**, and market-store publications from **702 to 12**, with equivalent resulting snapshots.
- Aggregation replies retain server-candle precedence and upstream event times. Ownership/revision checks cover logout, clear, reentrant updates, corrections and out-of-order replies. Ordinary sequential replies still preserve older buckets when a later rolling tick buffer no longer contains them. Failed batches isolate malformed symbols instead of dropping healthy siblings.
- The connection indicator subscribes only to values it displays. Hidden account diagnostics and websocket counters/timestamps no longer cause it to render. A React Profiler test confirms zero extra commits for five unrelated updates, while visible latency, stale status and open diagnostics still update.
- The always-mounted File menu shortcut owner no longer fetches symbols, builds an unused symbol tree or loads desktop-release metadata. The visible menu retains those behaviors.
- Chart templates load and mount on first use; chart context-menu mounting is deferred until first open. The context-menu code remains eagerly imported so dismissal listeners are available immediately. Both retain their state after first use. Template save-form visibility now follows the current mode, fixing Load-first followed by Save and repeated Save openings.
- Chart activation previously forced the same canvas resize/repaint immediately, on two animation frames and on a timer. Successful repeated refreshes now skip an unchanged chart instance and size. Failed/unmeasurable refreshes retry, changed sizes still refresh, and symbol/timeframe/activation changes reset the guard. Existing theme and visibility refresh paths remain.

The [aggregation benchmark](../artifacts/web-startup-profile-20260921/aggregation-batch-benchmark.json) runs the actual before/after store, manager and worker code with structured cloning in isolated Node VM contexts. It excludes React, browser scheduling, transport and whole-page startup. The final run's median enqueue-plus-publication time was 1,578.976 ms before and 228.824 ms after, with wide ranges of 705.388-2,444.184 and 96.960-431.881 ms respectively. These variable host timings are not a browser speedup claim; the message/publication counts and equivalent outputs are the deterministic results.

The first-view static JavaScript graph is **2,449,588 raw bytes / 735,674 gzip bytes**, only **5,543 / 1,022 bytes** smaller than pass 6. This remains a large initial graph. [Bundle profile](../artifacts/web-startup-profile-20260921/bundle-profile-pass7.json).

### Browser timings, including unsuccessful results

These are guest sessions using a local gzip production server and live Nexa APIs. First opens use fresh application asset URLs; refreshes use browser reload. Existing development tabs were retained. No build or test from this task ran during the final browser samples. Host resource availability was variable, and these are not controlled hardware, authenticated restore or deployed Docker/CDN measurements. The user's observed open terminal tab was Vite development at port 5174; the slow URL was not explicitly confirmed by the user.

All times are milliseconds from navigation, except long-task totals/maxima.

| Sample | Loading-screen FCP | Workspace mounted | Readiness gate | After-paint scheduling marker | Long-task total / max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Earlier pass 6 baseline: first open | 196 | 1888.2 | 2385.5 | 2477.6 | 1868 / 436 |
| Earlier pass 6 baseline: refresh | 148 | 483.3 | 1042.4 | 1879.5 | 915 / 468 |
| Pass 7 first open A | 336 | 3048.1 | 6163.1 | 6246.5 | 4098 / 1815 |
| Pass 7 refresh A | 208 | 2019.8 | 2663.2 | 2941.0 | 2321 / 634 |
| Pass 7 first open B | 320 | 1891.4 | 4948.7 | 5902.4 | 2065 / 1373 |
| Pass 7 refresh B | 256 | 2637.1 | 5873.7 | 9477.8 | 7509 / 2555 |

The profiler's final marker runs via an animation frame followed by a timer after the DOM readiness gate; it is not a screenshot or exact paint timestamp. Refresh B contains an unattributed 2,555 ms long task after its 5,873.7 ms gate, delaying that marker to 9,477.8 ms. The captured animation-frame entries do not identify that task's script. Its duration must not be assigned to a component or to the later 5000-candle fetch, which starts at 10,164.4 ms.

The first-open A trace attributes a 1,805.5 ms callback to the initial `liveTickDispatcher` flush and its synchronous subscribers, including 284.0 ms forced style/layout. Refresh B attributes a 456.6 ms callback to that same entry point, plus a 625.1 ms chart-library drawing callback and a 117.4 ms queued chart flush. Entry-point attribution includes downstream work and does not isolate each component's exclusive cost. Browser execution and rendering remain significant despite the worker-message reduction.

| Required request duration | First open A | Refresh A | First open B | Refresh B |
| --- | ---: | ---: | ---: | ---: |
| Initial public catalog | 1530.5 | 454.8 | 408.5 | 440.8 |
| Initial 500 candles | 3031.8 | 442.4 | 613.6 | 582.5 |

Requests overlap browser work; these durations must not be added to the rendering totals. First-open B also repeats the 500-candle request after the existing one-second speculative handoff expires while the browser is busy. Upstream timestamps and that freshness rule remain unchanged. All six samples made zero external runtime-config requests.

Evidence: [complete summary](../artifacts/web-startup-profile-20260921/pass7-final-summary.json), [baseline first open](../artifacts/web-startup-profile-20260921/pass7-baseline-first.json), [baseline refresh](../artifacts/web-startup-profile-20260921/pass7-baseline-refresh.json), [first open A](../artifacts/web-startup-profile-20260921/pass7-first-a.json), [refresh A](../artifacts/web-startup-profile-20260921/pass7-refresh-a.json), [first open B](../artifacts/web-startup-profile-20260921/pass7-first-b.json), [refresh B](../artifacts/web-startup-profile-20260921/pass7-refresh-b.json).

### Validation and local preview

TypeScript (`tsc -b`) and the final production build passed. Focused tests passed: 49 worker/store/tick tests; 70 File menu, Menu Bar and connection-indicator tests; 40 chart interaction-priority tests; two chart-type menu tests; two retained-feature tests; four chart-surface tests; one theme-transition test; and three template lifecycle tests. Repeated runs of the same test files are counted once here. Existing large-chunk and mixed static/dynamic import build warnings remain.

The final build was processed through the actual container entrypoint using the available shell tooling. Verification found one inline runtime-config script, zero external references, equivalent evaluated settings and unchanged standalone config bytes. This is not a Docker image build or running-container measurement. [Verification](../artifacts/web-startup-profile-20260921/pass7-container-inlining-verification.json).

Browser DOM inspection of pass 7 showed populated Market Watch and BTCUSD M1 chart controls; the chart context menu opened. The final visual recheck lost the browser connection, so no successful new screenshot, template browser check or authenticated production check is claimed. Template lifecycle behavior was covered by the focused tests. No orders were placed or closed.

A compiled preview was started at `http://127.0.0.1:5175/`. HTTP verification returned 200 with a hashed production entry, inline runtime configuration and no Vite development client. Restart this exact build with:

```powershell
npx.cmd vite preview --mode web --outDir artifacts/web-startup-profile-20260921/pass7-build --host 127.0.0.1 --port 5175 --strictPort
```

This preview is for local checking; it is not a deployment or a new timing sample. The user-owned development servers were left running. No live frontend/backend, nginx host or CDN configuration was changed. The deployment access limitation from pass 6 remains, and the local one-second acceptance target remains unmet.
