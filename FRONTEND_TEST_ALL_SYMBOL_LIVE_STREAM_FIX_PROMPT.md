# Frontend implementation prompt: make every demanded TEST symbol stream reliably

Use this prompt in `rtx5-broker-webterminal-ui`. Inspect the current source and preserve unrelated dirty-worktree changes. Implement and verify the fix; do not hardcode a list of symbols and do not only write a report.

## Direct diagnosis

TEST `/ws/v2` was directly verified streaming BTCUSD, XAUUSD, EURUSD, GBPUSD, USDJPY, US30, NAS100, US500, ETHUSD, and XAGUSD. The current frontend `/ws/feed` credential is rejected during handshake with HTTP 401 `broker_token_mismatch`.

When `/ws/feed` fails, the parallel App `/ws/v2` subscription is not based on the actual rendered Market Watch demand. It uses raw `activeWatchlist.symbols + selectedSymbol`; built-in watchlists store empty symbol arrays, while Market Watch separately renders effective default/persisted rows. This makes the surviving stream look limited to selected/persisted symbols, often BTCUSD/XAUUSD.

There is no BTCUSD/XAUUSD allowlist or parser limit. The defect is demand ownership, failover, and credential lifecycle.

## Relevant current paths

- Effective default symbols: `src/utils/marketWatchSource.ts`
- Built-in watchlist persistence: `src/store/useWatchlistStore.ts`
- Actual Market Watch rows and quote-eligible set: `src/components/layout/MarketWatchPanel.tsx`
- Quote catalog/status/REST snapshot: `src/hooks/useLiveMarketData.ts`
- Demand hook: `src/hooks/useQuoteSubscription.ts`
- Primary quote transport: `src/services/quoteSocketManager.ts`
- Broker/feed URL and credentials: `src/services/brokerSession.ts`
- Parallel v2 subscription: `src/App.tsx`
- V2 envelope/parser: `src/services/websocket-enhanced.ts`
- Shared tick dispatch: `src/services/liveTickDispatcher.ts`
- Quote stores: `src/store/useAppStore.ts`, `src/store/useMarketDataStore.ts`
- Chart demand: `src/components/TradingChart.tsx`

## Required frontend behavior

### 1. One authoritative quote-demand union

- Every mounted consumer must register a stable unique source ID and its normalized exact broker symbols.
- The manager must union actual Market Watch rows, every visible chart symbol, and any other live quote consumer.
- Adding, removing, switching, hydrating, mounting, and unmounting demand must immediately reconcile subscriptions.
- One consumer must never overwrite or remove another consumer's demand.
- Never use a raw empty built-in watchlist as a substitute for the rows actually shown to the user.
- Do not truncate a large watchlist or impose a two-symbol cap.

### 2. Preferred `/ws/feed`, authenticated `/ws/v2` failover

- Prefer broker `/ws/feed` and send:

  ```json
  {"type":"subscribe","symbols":["EURUSD","GBPUSD","USDJPY"]}
  ```

- If the feed handshake/auth fails and an account access token exists, immediately reconnect the **same demand union** to authenticated `/ws/v2`.
- Send one exact channel envelope per symbol:

  ```json
  {
    "action":"subscribe",
    "channel":"ticks.EURUSD",
    "channels":["ticks.EURUSD"]
  }
  ```

- On removal, send the matching transport-specific unsubscribe.
- On login, token rotation, broker change, or network recovery, retry the primary feed before falling back again.
- Do not use anonymous v2 fallback for an authenticated terminal session.

### 3. Broker-scoped credential lifecycle

- Persist the feed credential together with its normalized `feed_broker_id`.
- Clear the credential and scope when switching brokers without receiving a replacement, including when the new login returns an account token but no feed token.
- Clear both on logout.
- Never attach one broker's deployment/session feed credential to another broker URL.
- Redact tokens in every log and error.

### 4. Exact protocol and freshness handling

- Accept v2 tick frames shaped as `{channel:"ticks.EURUSD",data:{...}}` and preserve the channel symbol when the nested data omits it.
- Accept subscription confirmations with singular `channel`, array `channels`, or `symbols` as required by the two transports.
- Treat ACK as registration, not proof of live data. A row is live only after a valid fresh tick/status.
- Preserve backend symbol identity and valid suffixes; normalization must not merge different broker instruments.
- Keep explicit UI states for connecting, auth failed/fallback active, stale, market closed, unsupported, and no recent tick. Do not display a cached/REST row as live.

### 5. Remove the demand mismatch

- Do not keep a second independently calculated quote-symbol list in `App.tsx`.
- Either route all quote channels through the shared quote manager or make the App v2 path consume the same reactive demand registry.
- Keep account, position, order, deal, candle, and depth channel ownership separate from quote-row demand.

## Required regression tests

1. An empty built-in persisted watchlist still subscribes every effective rendered default row.
2. A custom watchlist add/remove/switch/hydration immediately reconciles symbols.
3. A `/ws/feed` pre-open 401/1006 and explicit auth-close code fail over all demanded symbols to `/ws/v2`.
4. V2 uses exact `channel` plus `channels` subscribe/unsubscribe envelopes.
5. Feed-token-only sessions do not attempt account-authenticated v2 fallback.
6. Login/token rotation retries primary feed.
7. Two simultaneous `useLiveQuotes` consumers have distinct source IDs and cannot overwrite each other.
8. Multiple charts contribute/remove demand independently.
9. At least 50 demanded symbols are sent without truncation.
10. Singular v2 subscription acknowledgement and channel-only tick identity are parsed.
11. Stale/silent/unsupported rows do not become live from acknowledgement or cached REST values.
12. Broker switch and logout remove both feed token and `feed_broker_id`.

## Live acceptance matrix

After the backend supplies a valid feed credential, authenticate normally and verify in the running terminal—not only unit tests:

- BTCUSD, XAUUSD
- EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD
- US30, NAS100, US500
- ETHUSD, XAGUSD
- one currently open stock if TEST advertises it as fresh/tradable

For every row capture requested transport/channel, subscription result, first-tick latency, tick count over at least 30 seconds, last source timestamp, freshness, and rendered bid/ask updates. Then force primary-feed failure, prove the entire same set continues through v2, restore/rotate the feed token, and prove the manager returns to primary without duplicates or gaps.

Do not claim that all catalog instruments tick 24/7. The correct requirement is: every exact, entitled, currently open/streamable symbol receives live updates; closed, unsupported, stale, and provider-failed symbols are identified truthfully.
