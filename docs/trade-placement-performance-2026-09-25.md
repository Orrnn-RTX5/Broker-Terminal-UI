# Trade-placement verification — 25 September 2026

## Result

Fixed avoidable frontend recovery delays and unnecessary Trade-table work. Live demo testing also reproduced variable confirmation time. The measured frontend enqueue path took 1–2.7 ms, while complete order attempts ranged from 450.7 to 3,506 ms. These are individual observations, not a before/after speedup or a latency guarantee.

## Live demo verification

Tested the local web terminal at `http://127.0.0.1:5173`, already authenticated to the ORRNN demo account supplied by the user. No credentials were added to files or reports. Each test was a 0.01-lot BTCUSD buy; each resulting position was individually closed. The five pre-existing positions were retained.

| Test position | Terminal click-to-result | Click-to-WS enqueue | WS acceptance RTT | WS fill RTT | Gateway Journal duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1343678 | 3,506 ms | Not instrumented | Not instrumented | Not instrumented | 112 ms |
| 1345751 | 2,628.1 ms | 2.7 ms | 770.2 ms | 2,625 ms | Not captured |
| 1347203 | 450.7 ms | 1.0 ms | 297.1 ms | 449.3 ms | 97 ms |

The third test's temporary Long Tasks observer detected three overlapping tasks, with 150.6 ms combined overlap and a longest task of 97 ms. This measures browser tasks of at least 50 ms, not all frontend CPU time or causal delay. The earlier slow tests did not have that observer active. Browser automation also intermittently timed out; control-tool timing was not used as order timing.

Gateway close records were observed for the test positions. Open-position checks after closing each test returned to the original five tickets: 1310156, 1310161, 1310167, 1310173, and 1310178. Demo-account balances/P&L can change because of these actual demo executions.

The live timings came from the existing order telemetry and Journal. Temporary development-only duration logging and the Long Tasks observer were removed after measurement. No live order was simulated as a successful fill.

## Frontend changes

- Recognize backend `order_error` and `order_status_error` messages immediately, instead of ignoring them until the 10-second WebSocket timers fire.
- Use read-only status recovery for an already-sent order, never a second create request. Recovery starts its first GET immediately; later polls retain the existing one-second spacing and original deadline.
- Continue accepting the original correlated WebSocket terminal response during HTTP recovery. A valid late fill wins even if a status GET is stalled. Listeners and sleep timers are cleaned up, and a late GET failure cannot create an unhandled rejection.
- Share terminal classification across both paths: temporary rejections and malformed fill messages do not falsely complete an order; backend expiry remains expiry. Both WebSocket request ID and durable client order ID must match.
- Separate the REST response timing (`rest_response`) from the complete REST command lifecycle (`rest_completed`) in telemetry.
- Remove unused transport/status props that defeated TradeTab memoization. A regression reproduced 20 unnecessary table renders before the change and zero after it, with position changes still appearing without a timer delay.
- Add the missing React key to sortable table headers.
- Skip synchronous history-cache reading, parsing, and sorting on pure current-price/P&L updates. Cache-relevant identifier, SL/TP (including clearing to zero), volume, entry-price/time changes still update storage; account/broker changes and restored state force initialization. This optimization was added after the live timing samples above and is covered by focused regression tests.

## Remaining backend/transport investigation

The observed 112/97 ms Gateway figures do not cover the entire browser-to-fill path. The second test spent 2,625 ms after WebSocket enqueue before the fill handler ran; its frontend enqueue took 2.7 ms. That warrants correlated transport/server-delivery evidence. It does not by itself prove that all remaining time is backend processing.

The inspected backend checkout is `C:/Users/ADMIN/.codex-tmp/rtx-startup-backend-20260921`, baseline revision `ea7684b1572e7f3cacde599ac1a1306120b2cead`, with pre-existing local edits. Its deployed equivalence is unverified. It already contains notification-based command wakeups and Rust execution paths, so introducing a new language or transport without measurements is unwarranted.

Ask the backend operator for the active deployed revision and a redacted snapshot of `GET /api/v2/admin/order-command-metrics` around a slow trade. This endpoint is admin/manager protected; demo credentials are not a substitute for operator access. Relevant measurements already present in the inspected source include:

- Admission, database-pool acquisition, queue wait, account lock, and economic commit durations.
- Terminal notification/reload duration and `terminal_listen_live` / wake-versus-poll counters.
- WebSocket outbound queue and write durations.
- Execution owner, fast-fill/admission settings, and database-pool pressure.

Correlate receipt, execution completion, terminal notification, frame enqueue/write, browser acceptance, and browser fill by the same order IDs. Check reverse-proxy/WebSocket delivery and client main-thread scheduling as well. No backend configuration or code was changed or deployed in this task.

## Verification scope

Final TypeScript project build passed. The final focused regression run passed **149 tests across 12 files**, covering transport, command recovery, order API, telemetry, Journal, Trade rendering, and position/account state. Whitespace checks passed for changed source files.

Final web and Electron renderer builds both passed, written to `artifacts/trade-placement-20260925/web` and `artifacts/trade-placement-20260925/electron`. Existing mixed-import and large-chunk warnings remain; they did not fail the builds.

Automated coverage exercises the real WebSocket client with a fake socket through API recovery, duplicate-create prevention, late fills, malformed/unrelated frames, expiry, polling deadlines, and immediate Trade-table updates. Live verification used the authenticated local development web app. Web and Electron renderer builds are separate from deployment or installation; no production deployment or desktop installer update was performed.
