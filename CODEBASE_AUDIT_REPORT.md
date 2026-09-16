# RTX Terminal Codebase Audit Report

**Audit date:** 2026-09-16  
**Repository:** `rtx5-broker-webterminal-ui`  
**Audited checkout:** `4ff9b22363133bcc939ebacda17220b33d2a4a84` plus the pre-existing modified and untracked working-tree files present during the audit  
**Application version:** `1.0.25`  
**Audit type:** Read-only, literal authored-file review and architecture/behavior synthesis

---

## 1. Purpose of this report

This report records:

- what was read during the codebase audit;
- what is currently implemented;
- how the main runtime flows work;
- which modules own each responsibility;
- which behaviors are active, legacy, disconnected, proposed, or generated;
- important invariants that future changes must preserve;
- confirmed defects, architectural risks, documentation drift, and maintenance hazards;
- recommended remediation priorities and verification commands.

This is an implementation audit, not a claim that the application was executed successfully. No source file was changed during the reading pass. No test, typecheck, lint, build, Electron package, or live-backend verification command was run as part of that pass.

The checkout was already heavily modified before this report was created. Therefore, this document describes the **local working-tree snapshot that was actually read**, not only the pristine Git commit named above. Existing environment changes, source changes, and untracked September 2026 QA work were not created or reverted by the audit.

---

## 2. Audit scope and method

### 2.1 Authored material read

The audit covered the readable authored material directory by directory, including:

- application entry points and shell orchestration;
- React components, dialogs, menus, panels, dock surfaces, and tests;
- API clients, transport code, authentication, broker discovery, and trading logic;
- Zustand stores and persistence code;
- hooks, contexts, constants, types, utilities, and their tests;
- chart data, candle, indicator, workspace, drawing, print, export, and screenshot services;
- the full large `App.tsx`, `TradingChart.tsx`, `BottomDock.tsx`, and `drawingManager.ts` orchestrators;
- drawing tool catalogs, geometry/rendering code, annotation editors, and drawing tests;
- CSS and theme layers;
- locale catalogs and locale completeness tests;
- startup/runtime split and performance-contract tests;
- examples, pages, old dashboards, standalone HTML demonstrations, and helper modules;
- Electron main-process, network, preload, updater, packaging, and release code;
- root build/test/lint configuration and `package.json`;
- the complete `swagger.yaml` contract;
- deployment scripts and GitHub workflows;
- maintenance scripts, localization generators, icon migration scripts, and benchmark scripts;
- project documentation, QA notes, historical implementation prompts, and research notes;
- the Antigravity editor-preview bridge;
- both MQL5 Expert Advisor files;
- standalone tests under `src/test` and `src/tests`;
- ignore files, license/attribution text, and scratch textual diffs.

### 2.2 Material inventoried but not treated as authored readable source

The following were cataloged but were not line-read as application source:

- `node_modules` and dependency contents;
- generated build/package output such as `dist`, `draft`, and Vite caches;
- package-lock dependency data;
- temporary folders, generated logs, copied diagnostics, and agent/QA output;
- `jscpd-report` and other generated reports;
- screenshots, videos, fonts, icons, and other binary media;
- the bulk generated Twemoji SVG corpus;
- generated visual-comparison fixtures and recordings.

Environment files were identified, but their secret or deployment-specific values are intentionally not reproduced in this report.

### 2.3 Evidence classification used in this report

Not every file has equal authority:

1. **Active runtime code** is the strongest evidence of current frontend behavior.
2. **Tests** show intended contracts but do not prove they currently pass because tests were not run.
3. **Configuration and workflows** show what can be built or deployed, subject to whether the workflow is enabled.
4. **Swagger and documentation** describe intended or historical contracts; they do not prove backend deployment behavior.
5. **Fix prompts and incident documents** describe requested future behavior or past failures, not necessarily implemented behavior.
6. **Examples and standalone HTML files** are demonstrations or diagnostics unless imported by the active runtime.
7. **Artifacts and QA notes** are historical evidence only; they are not a fresh validation result.

---

## 3. Executive result

RTX Terminal is a large, production-oriented trading-terminal frontend, not a small demonstration project. Its active stack is React 19, Vite 7, TypeScript, Zustand, Lightweight Charts, Vitest, Tailwind/PostCSS, and Electron.

The implementation currently includes:

- broker discovery and branded broker selection;
- authenticated web and Electron startup paths;
- cold session restoration and same-document login handoff;
- guest/anonymous market viewing;
- account, position, order, deal, instrument, and market-state hydration;
- authenticated quote, candle, account, position, order, and deal streams;
- dedicated low-latency WebSocket market-order placement with idempotent REST/status recovery;
- market, position close, partial close, and SL/TP modification flows;
- multi-chart docking with up to six stable chart hosts;
- historical and live candlestick charts, derived timeframes, indicators, trade overlays, and interactive trade levels;
- a large local drawing system with many TradingView-style tool families;
- Market Watch, Depth of Market, account/trade/history/journal surfaces, order dialogs, chart tools, menus, shortcuts, print, screenshot, and export support;
- dark/light styling and 19 primary UI locale catalogs;
- a sandboxed Electron shell with a restricted preload API and release/update integration;
- broad automated test coverage at the source level.

The strongest parts are the exact-symbol handling, broker/account scoping, event-time freshness rules, chart price-integrity guards, stable chart-host architecture, drawing isolation, and the order placement rule that avoids creating a duplicate order after a WebSocket send becomes uncertain.

The most important remaining problems are:

1. tokens and routing metadata are mainly stored in browser storage rather than genuinely secure storage;
2. the New Order dialog can close after a failed submission because `App.tsx` catches the failure without rethrowing it;
3. unresolved order-command ownership is held in process memory and is not durably rehydrated after reload/restart;
4. the frontend can synthesize `expired` after its own deadline even when durable broker truth may only be unknown;
5. overlapping account/portfolio writers do not share a single monotonic backend revision;
6. several very large orchestrators combine too many concerns;
7. active code, legacy code, desired specifications, and stale documentation coexist without a clear repository boundary;
8. TypeScript strictness and deployment/documentation quality do not match the apparent production criticality.

---

## 4. Technology and build model

From `package.json`:

- React `19.2.x` and React DOM;
- Vite `7.2.x`;
- TypeScript `5.9.x`;
- Zustand `5.x`;
- Lightweight Charts `5.1.x`;
- Vitest `4.x` with Testing Library and jsdom/happy-dom support;
- i18next/react-i18next;
- Electron `40.x`, electron-builder, and electron-updater;
- Tailwind CSS 4/PostCSS, plus substantial handwritten CSS;
- Axios, lodash-es, Papa Parse, Lucide, and html2canvas-pro.

The repository defines multiple frontend modes:

- `web`;
- `normal`;
- `electron`;
- `desktop`.

Primary scripts are:

```text
npm run dev
npm run dev:web
npm run dev:electron
npm run build:web
npm run build:electron
npm run typecheck
npm run lint
npm run test:run
npm run test:coverage
npm run electron:build
npm run electron:publish
```

Electron packaging uses NSIS, writes packages to `draft`, and publishes releases to the separate public `rtx5-terminal-releases` GitHub repository when the publish command/workflow is used.

---

## 5. Repository responsibility map

### 5.1 Root files

The root contains the web entry page, package/build configuration, Electron entry files, Docker configuration, API specification, deployment/setup documents, historical fix prompts, visual research notes, standalone demos, migration/generator utilities, and generated or historical artifacts.

Important root files include:

- `package.json` — dependencies, scripts, Electron packaging, and release destination;
- `index.html` — browser entry document;
- `electron.cjs`, `electron-network.cjs`, `preload.cjs` — desktop runtime and renderer bridge;
- `vite.config.ts`, `vitest.config.ts`, TypeScript and lint/PostCSS configs — build and test behavior;
- `swagger.yaml` — broad backend API description, with drift noted later;
- `src/Critical  Instruction.md` — a compact desired architecture contract, not fully satisfied by current code;
- `README.md` — substantially outdated;
- `Dockerfile` and web deployment documentation;
- `Demo-Theme.html`, `professional-dashboard-demo.html`, `theme-preview.html`, and `websocket-test.html` — standalone demonstrations/diagnostics, not the active React runtime;
- localization/icon generation and migration scripts — one-off maintenance tools that can perform broad rewrites.

### 5.2 `src/api`

This directory contains lower-level HTTP and trade clients:

- generic client setup and endpoint helpers;
- broker API singleton behavior;
- authentication payload normalization;
- history requests;
- close-position request normalization;
- trade gateway and trade socket implementations;
- hooks and tests around API contracts.

There is more than one API abstraction. This is partly historical and partly responsibility-specific, but it raises the risk that authentication, routing, errors, and response normalization differ between call paths.

### 5.3 `src/services`

This is the largest logic layer. It contains:

- broker discovery, directory, presentation, identity, and session scope;
- account, quote, FIX-market-data, candle, and order sockets;
- market-order orchestration and durable-command polling;
- chart history, aggregation, caching, validation, export, print, and command targeting;
- dock/workspace management;
- drawing APIs and the local drawing manager;
- indicator, history, account, screenshot, data-folder, and persistence services;
- keyboard shortcuts, command bus, error handling, and exit behavior;
- local-first close/reconciliation support;
- desktop release helpers;
- extensive adjacent unit/contract tests.

### 5.4 `src/store`

Zustand stores cover the core app, market data, dock layout, toolbar state, chart settings/templates/zoom, drawings, watchlists, alerts, notifications, journals, advanced orders, analysis tools, risk/exposure, news, sessions, sentiment, signals, backtesting, simulation, and other optional features.

A store’s presence does **not** mean its feature is connected to the active shell. Several advanced stores support secondary, prototype, or partially integrated components.

### 5.5 `src/hooks`

Hooks bridge React to:

- guest and authenticated market data;
- quote and candle subscriptions;
- account/position state;
- toolbox trade reconciliation;
- exact broker/account session scope;
- chart visibility, selection, export, and print;
- docking/workspaces;
- keyboard/context-menu behavior;
- market status and connection health;
- Electron updater/release state;
- translation and UI helpers.

### 5.6 `src/components`

The active component surface includes the terminal shell, Market Watch, charts, docking, one-click trading, the order dialog, Depth of Market, account/trade/history/journal surfaces, menus, toolbars, dialogs, connection feedback, and desktop window chrome.

The same directory also contains many advanced analytics, AI, news, copy-trading, multi-account, backtest, replay, and dashboard components. Some contain real implementation code and stores, but many are not wired into the active terminal runtime. Their presence must not be reported as a fully operational product feature without tracing an active import and backend path.

### 5.7 `src/drawing-tools` and drawing services

This area contains tool catalogs, geometry/rendering modules, editor components, icon/pictograph catalogs, runtime adapters, CSS, and tests. The project explicitly treats drawing code as an isolated subsystem. Future unrelated changes should avoid modifying it.

### 5.8 Styles and locales

- `src/styles` and component CSS files form a layered dark/light theme and typography system.
- `src/locales` contains 19 large primary UI catalogs plus additional smaller/menu-oriented catalogs.
- Locale tests enforce key/placeholder completeness, not translation quality.

### 5.9 Tests

Tests are colocated throughout `src`, with additional standalone suites in `src/test` and `src/tests`. They cover startup contracts, API behavior, symbol identity, sockets, order idempotency, account/session scope, chart interactions, drawing geometry, dock persistence, localization, CSS/presentation contracts, print/export, and numerous regressions.

### 5.10 Ancillary areas

- `.github` — disabled web deploy workflow, active Electron release automation, and deploy helper script;
- `scripts` — Antigravity preview launcher/installer, its test, and an order benchmark;
- `tools/antigravity-preview-bridge` — local editor extension/bridge;
- `mt5-trading-panel` — two standalone MQL5 Expert Advisors;
- `docs` — deployment, Electron release, chart layout, shortcut, and preview documentation;
- `examples`/pages/standalone HTML — demonstrations and legacy integrations;
- `artifacts`, temporary QA folders, and screenshots — historical/generated evidence rather than runtime source.

---

## 6. End-to-end runtime logic

### 6.1 Initial browser/desktop boot

The effective startup chain is:

```text
index.html
  -> src/main.tsx
  -> src/bootstrap.tsx
  -> src/AppShell.tsx
  -> anonymous/login shell OR dynamically loaded authenticated App.tsx
```

`main.tsx` performs storage migration and mounts React. It also unregisters old service workers. In Electron mode it suppresses console methods and global error/rejection reporting; this reduces renderer noise but can hide production failures during diagnosis.

`AppShell.tsx` intentionally keeps the large authenticated terminal out of the anonymous startup bundle. It supports:

- anonymous broker/login presentation;
- lazy/preloaded authenticated runtime modules;
- an in-memory same-document authenticated handoff after login;
- restoration from persisted session information after a cold load;
- a loading fallback while the authenticated runtime is fetched.

Startup-specific tests assert bundle and performance boundaries, but those tests were not executed in this audit.

### 6.2 Guest market mode

Guest mode is currently implemented, not merely proposed.

The guest hook/service:

1. requests public symbols from `/api/v1/market/symbols` without account credentials;
2. polls approximately every three seconds;
3. preserves upstream/source timestamps;
4. dispatches normalized ticks into existing market/application stores;
5. permits anonymous chart/market viewing;
6. does not start account-specific transports.

This is intentionally distinct from authenticated account state. A guest should not receive account, position, order, or deal subscriptions.

### 6.3 Broker discovery and login

The login flow is spread across `WelcomeTerminal`, broker directory/discovery/presentation services, backend target configuration, login payload helpers, API clients, and `brokerSession`.

The flow is broadly:

1. load/discover available brokers;
2. normalize exact broker identity, display name, logo, theme color, server URL, and aliases;
3. show a searchable branded broker/server picker;
4. validate/health-check the selected backend where applicable;
5. submit credentials with broker identity to the selected backend;
6. receive access token, refresh token, expiry, and routing/account data;
7. commit broker/account session scope;
8. pass the authenticated result to `AppShell` through an in-memory handoff;
9. load the authenticated terminal.

Broker identity is not just decoration. It affects HTTP base URLs, WebSocket endpoints, feed authentication, account scope, persistence keys, logos, and terminal title. Alias mapping is used because public/deployment broker names can differ from feed/backend IDs.

### 6.4 Token/session behavior

The API layer includes:

- bearer-token attachment;
- proactive refresh near expiry;
- coalescing of concurrent refresh attempts;
- one-time recovery/retry on HTTP 401;
- foreground/session recovery behavior;
- broker/account-scoped routing.

The authenticated handoff is memory-only, and the committed active account scope is intentionally runtime-oriented. However, access/refresh tokens and several broker/routing/account hints are still read from or written to `localStorage`/`sessionStorage`. That is convenient for cold restoration but is not equivalent to secure credential storage.

### 6.5 Authenticated dashboard hydration

`App.tsx` is the central coordinator. After authentication/restoration it hydrates account-facing state using parallel or coalesced API requests for combinations of:

- current user/session;
- accounts and selected account;
- account metrics;
- positions;
- active/pending orders;
- deals/history;
- instrument/favorite metadata;
- market status.

It then starts quote/candle/account transports according to the current broker, account, visible symbols, selected chart, and session epoch.

A session-scope key protects against applying results from a previous broker/account after a switch or logout. This scope is a critical invariant and must remain attached to async work, socket events, order latency data, and persisted chart/drawing state where applicable.

### 6.6 Realtime transport model

Realtime behavior is deliberately split by workload:

- **Market Watch quotes:** primarily owned by `QuoteSocketManager` and quote-subscription hooks;
- **selected chart ticks/candles/depth:** subscribed according to the active chart/pane;
- **account/position/order/deal channels:** account-scoped authenticated subscriptions;
- **market orders:** a dedicated authenticated low-latency trade socket;
- **candle history:** REST/history service with live candle updates and fallback behavior;
- **guest quotes:** public polling, not an authenticated account socket.

The quote path prefers the authenticated `/ws/feed` transport and can fail over to `/ws/v2`. Reconnect logic re-authenticates/re-subscribes with backoff. Candle socket code includes subscription acknowledgement deadlines, heartbeat/pong handling, disconnect recovery, and public/history fallbacks.

Ticks are normalized and batched through `liveTickDispatcher` into the central application and market-data stores. Source timestamps, not merely browser arrival time, decide freshness. This prevents an older delayed frame from overwriting a newer quote.

### 6.7 Exact symbol identity

The code intentionally preserves exact broker symbols, including dots, suffixes, and channel-derived names. Examples include symbols whose broker identity is not safely recoverable by stripping punctuation or guessing a base pair.

Important consequences:

- transport channel parsing must preserve the complete suffix;
- chart, Market Watch, order, history, and drawing scopes must use the same exact identity;
- display descriptions can be normalized separately, but execution symbols cannot;
- fallback code must not silently map one broker symbol to another.

This invariant has dedicated tests and is one of the better-defended parts of the project.

---

## 7. Trading and order lifecycle

### 7.1 Market-order placement

The current market-order implementation is more robust than a simple “WebSocket first, REST second” fallback.

For one user intent, the flow is:

1. capture the intent start time for latency reporting;
2. resolve and validate the current broker/account session;
3. validate the exact executable symbol, market status, side, and volume;
4. generate one UUID-v4 `client_order_id` for that intent;
5. prefer the authenticated trade WebSocket when it is open, authenticated, unchanged, and not backpressured;
6. serialize and send `place_order` with the same client ID;
7. omit inactive zero SL/TP fields on WebSocket because the deployed validator reportedly rejects a present zero, while preserving positive values exactly;
8. correlate acknowledgement/fill/rejection/status events by request/client ID;
9. use REST only if the WebSocket path was definitely unsent or fields are unsupported;
10. if a WebSocket create may already have been sent, do **not** issue a second create; reconcile the original UUID by status;
11. publish scoped latency and placement-state events;
12. refresh orders/history/positions after terminal outcomes.

This “definitely unsent versus may have been sent” distinction is essential. A generic catch-and-POST fallback would risk duplicate live trades.

### 7.2 REST and durable command recovery

REST placement supports two backend shapes:

- a legacy immediate Position-like response;
- an asynchronous order-command response.

For an asynchronous command, `orderCommandLifecycle.ts`:

- normalizes accepted/processing/filled/rejected/expired responses;
- retains backend error code/message data;
- validates the response `client_order_id` against the request;
- polls status about once per second;
- honors backend `execute_before` when available;
- otherwise uses a 30-second fallback deadline;
- performs a final status read at the deadline;
- returns a normalized terminal result.

### 7.3 Remaining order-lifecycle weaknesses

#### A. New Order dialog false-success behavior

`OrderPanelDialog` waits for `onSubmitOrder`, then updates Last Symbol and closes. `App.handleOrderPanelSubmit` catches placement errors, publishes feedback, and returns normally instead of rethrowing. Therefore, a failed placement can look successful to the dialog and cause it to close.

Required correction: after publishing the normalized error, the callback must reject/rethrow so the dialog keeps its error state and remains open. A regression test should assert that a rejected placement does not close the dialog or update Last Symbol.

#### B. Unresolved command ownership is not durable

The browser process remembers pending/reconciling work in memory. A reload, renderer crash, browser restart, or Electron restart can lose ownership of an unresolved command. The backend may still execute it, but the frontend may no longer know it must recover that UUID.

Required correction: persist a session-scoped unresolved-command registry before/at send, rehydrate it on startup, query status with the same UUID, and remove it only after a backend-confirmed durable terminal result.

#### C. Client-generated `expired` is stronger than the evidence

After `execute_before` or the 30-second fallback, the polling helper can create an `expired` terminal object, including after a failed final read. That is a client interpretation. Unless the backend itself confirms expiration, the durable truth may be “unknown; reconciliation required,” not “expired.”

Required correction: distinguish backend-confirmed `expired` from client-side `timed_out/unknown`, and continue safe reconciliation according to a documented retention policy.

#### D. Pending display entries have a local orphan timeout

`useToolboxTradeData` expires pending market-order display entries after 120 seconds. This prevents permanent UI ghosts, but it is not a substitute for durable command recovery.

### 7.4 Position operations

The active code supports:

- full position close;
- partial close by volume;
- SL/TP modification;
- close-all/concurrent close helpers;
- local-first close coordination and later server reconciliation;
- trade feedback and refresh events;
- interactive chart-level modification paths.

As with market orders, exact account/symbol/ticket scope and idempotent UI behavior are important. Position state can be updated by snapshots, sockets, local close state, and toolbox reconciliation, which contributes to the revision-ordering risk described below.

### 7.5 Trade latency journal

The latency instrumentation records intent, API, serialization, socket, REST, terminal, and recovery phases. Journal presentation filters samples by committed session scope, deduplicates by attempt/client ID, and prefers complete API-to-terminal duration over only the last transport leg.

This is useful operational instrumentation, but it is browser-process telemetry, not an authoritative broker execution audit trail.

---

## 8. Account and portfolio state

### 8.1 Active presentation

The active Trade surface uses backend-provided values for:

- balance;
- equity;
- used margin;
- free margin;
- margin level;
- floating P/L and related totals.

Although `src/Critical  Instruction.md` asks the client to compute equity on every tick, the active implementation correctly trends toward backend-authoritative equity/free-margin/margin-level values. When data is unavailable, it can show an unavailable marker rather than fabricate a financial value.

A normalizer also protects against a partial packet abruptly replacing a previously funded balance with zero and marks associated values as untrusted. This is defensive, but it is still a heuristic around incomplete backend packets.

### 8.2 Multiple state writers

Account and portfolio state can be changed by:

- initial REST snapshots;
- foreground refresh;
- account socket packets;
- position socket packets;
- `App.tsx` reconciliation;
- `useToolboxTradeData` refreshes;
- local-first close behavior;
- order terminal refreshes.

The code uses session scope and local ordering protections in several places, but there is no single shared monotonic portfolio revision spanning all writers. A late REST snapshot can therefore compete with a newer socket state without one universal backend version rule.

Recommended backend/frontend contract:

- attach an account/portfolio revision or sequence to every snapshot and stream event;
- apply only revisions newer than the last committed revision for that broker/account;
- make partial packets explicit with field-presence semantics;
- avoid treating absent margin as numeric zero;
- retain the server as authority for balance, equity, margin, and execution state.

### 8.3 Bottom dock behavior

The dock contains active Trade, Exposure, History, and Journal-oriented functionality, with configurable columns and account summaries. It switches to Trade on placement events. It also contains a global `window.testBlowup` diagnostic that forces account values to zero and switches to Journal when equity crosses from positive to non-positive. That diagnostic should be development-gated or removed from production runtime.

---

## 9. Market data and candle integrity

### 9.1 Quote pipeline

The quote pipeline:

1. derives symbol demand from visible Market Watch rows and active chart needs;
2. establishes authenticated or guest data transport;
3. parses channel/frame payloads without losing exact symbol identity;
4. normalizes bid, ask, timestamps, and market metadata;
5. orders updates by source event time;
6. batches writes to avoid React/store pressure;
7. feeds Market Watch, chart, status, and trade-facing consumers;
8. reconnects/resubscribes with backoff.

### 9.2 Candle pipeline

Historical and live candle code covers:

- history REST loading;
- cache and request ownership;
- live candle subscriptions;
- M1-derived higher-timeframe aggregation;
- timeframe boundary calculations;
- worker-assisted aggregation;
- heartbeat and ACK handling;
- stale request rejection;
- market-closed gaps/tails;
- chart-visible runtime management.

The system does not intentionally invent missing candles merely to fill visual gaps.

### 9.3 Price-integrity guards

`chartPriceGuards` and related history logic reject or fail closed on incompatible price bands and mixed-scale data. They do not silently multiply or divide broker OHLC data to make it resemble the current quote.

This is important because repository incident documents describe proven mixed-scale contamination for instruments such as XAUUSD. Those documents are useful historical evidence and desired backend contracts, but they do not prove that every backend deployment is now corrected.

### 9.4 Remaining market-data risk

The frontend has careful freshness and integrity checks, but it cannot repair a backend that emits contradictory symbol identities, timestamps, or price scales. Transport diagnostics should preserve raw channel, source timestamp, broker identity, and normalized result so backend incidents can be distinguished from frontend rendering defects.

---

## 10. Chart runtime

`TradingChart.tsx` is a very large chart runtime (approximately ten thousand lines in the audited snapshot). It combines:

- Lightweight Charts setup and teardown;
- history loading and live updates;
- candlestick/bar/line presentation;
- time and price scale behavior;
- visible range and zoom persistence;
- chart type/timeframe/symbol commands;
- crosshair, keyboard, mouse, touch, and interaction ownership;
- candle countdown, legends, separators, grids, and labels;
- indicators and indicator panes;
- drawing integration;
- open position/order/history overlays;
- SL/TP and trade-level dragging;
- one-click trading and chart trade controls;
- theme transitions;
- screenshot, print, and export coordination;
- chart cleanup and retained state.

The implementation is feature-rich, but its size makes regressions likely when changing seemingly local behavior. Any chart change should first identify which concern owns the behavior: `TradingChart.tsx`, a chart utility, chart service, store, dock command, drawing manager, or active-chart source.

### 10.1 Chart data authority

- Historical OHLC comes from broker/public history services.
- Live bars are updated from broker ticks/candles and aggregation logic.
- Quote timestamps and candle boundaries are treated carefully.
- Incompatible data is rejected rather than rescaled.
- Derived timeframes are calculated from lower-timeframe data when appropriate.

### 10.2 Trade overlays

The chart can present open positions, pending/order levels, historical trade levels, current prices, and interactive SL/TP controls. These overlays depend on the same session/account/symbol identity rules as the order and portfolio systems.

### 10.3 Print/export

The code includes chart printing, preview/setup dialogs, screenshot capture, image export, CSV-related safety, and share/export helpers. These are real code paths, but browser print/download behavior and Electron file behavior differ and should be verified separately.

---

## 11. Docking, charts, and workspace logic

The active dock/workspace architecture supports up to six persistent chart panels. Key behavior includes:

- stable chart host IDs;
- per-pane symbol, timeframe, chart type, and state;
- selected/active chart source tracking;
- tiled and cascade arrangements;
- floating and minimized windows;
- chart tabs and closed-chart restoration behavior;
- undo/redo;
- workspace/layout persistence;
- exact-pane command targeting;
- retained chart instances to avoid unnecessary remounts during layout changes.

The stable-host design is important: layout changes should move or resize hosts rather than destroy/recreate charts and lose expensive state.

Workspace profiles are primarily local. Future server synchronization should preserve account/broker scope and merge/version semantics rather than overwrite a newer local layout blindly.

---

## 12. Drawing subsystem

The drawing subsystem is extensive and deliberately isolated from unrelated application changes.

Implemented tool families include combinations of:

- trend lines, rays, horizontal/vertical lines, channels, and pitchfork variants;
- Gann and Fibonacci tools;
- forecasting and measurement tools;
- chart patterns;
- brush, highlighter, paths, polylines, curves, arcs, rectangles, ellipses, and arrows;
- annotations and editable text/table cells;
- pictographs/icons;
- information/measurement lines;
- selection, handles, hit testing, edit, clone, remove, and recovery behavior.

Drawings are scoped using combinations of:

- chart identity;
- exact symbol;
- timeframe;
- broker/account context;
- drawing context key.

Local drawing behavior and persistence are active. Although a drawing API module exists, backend drawing loads are deliberately bypassed in the current behavior, so the presence of API code must not be interpreted as active server-synchronized drawings.

The subsystem has many focused tests for geometry, persistence, catalog definitions, rendering, regression recovery, annotations, patterns, Gann/Fibonacci, pictographs, forecasting, and brush/shape tools. Those tests were read but not run.

---

## 13. UI, menus, tools, and feature status

### 13.1 Clearly active/integrated surfaces

The active shell includes or directly coordinates:

- broker/login/welcome screens;
- desktop window shell and identity/title behavior;
- Market Watch and symbol selection;
- multi-chart workspace;
- top toolbar, menu bar, file/chart/window commands, and shortcuts;
- order entry and one-click trading;
- Depth of Market;
- account/trade/exposure/history/journal dock content;
- chart context menus, properties, objects, templates, print, and export;
- dialogs for modifying positions, account actions, confirmations, and feedback;
- connection and market-status presentation;
- light/dark theme and language selection.

### 13.2 Code present but not necessarily active end-to-end

The repository also contains substantial components/stores for:

- AI chart analysis;
- analytics dashboards;
- advanced orders;
- alerts and rule management;
- backtesting and market replay;
- copy-trading leaderboard;
- correlation, sentiment, volatility, screeners, and risk tools;
- economic calendar/news analysis;
- multi-account tools;
- order-flow, market-profile, and multi-timeframe analysis;
- administrative and LP comparison dashboards.

Some are implemented UI prototypes, some use local/sample state, and some have partial service/store support. They must be classified individually before being promised as production features. Several visible menu entries are intentionally locked because the required runtime/backend service is not connected.

---

## 14. Persistence model

Browser persistence is used for combinations of:

- authentication/session restoration;
- broker and backend routing hints;
- selected account/user hints;
- app/store state;
- chart settings, zoom, templates, and layout;
- workspace profiles;
- drawings/tool preferences;
- watchlists and selected/last symbols;
- UI settings and language/theme preferences;
- order-dialog lot size and other convenience values.

Persistence is distributed across service helpers and Zustand persisted stores. This makes key migration and logout cleanup important. Sensitive credentials should not share the same storage strategy as harmless preferences.

A future persistence cleanup should classify every key as one of:

1. secret credential;
2. broker/account-scoped runtime recovery state;
3. user preference;
4. chart/workspace content;
5. disposable cache;
6. diagnostic data.

Each class needs explicit lifetime, scope, migration, logout, and corruption behavior.

---

## 15. Localization and typography/style system

### 15.1 Localization

The active interface has 19 primary populated UI locale catalogs. Additional smaller catalogs largely cover menus and often contain English fallback text rather than complete native translations.

The test suite verifies:

- required key parity;
- placeholders/interpolation compatibility;
- basic catalog loading contracts.

It does not verify translation quality. Several strings contain encoding corruption or question-mark replacement, including translations of “Invalid price.” The old locale generation scripts target a larger language set and can overwrite catalogs with sparse translations or English fallback; they should not be run casually.

### 15.2 Styling

The visual system combines:

- base/global styles;
- component CSS;
- Tailwind utility use;
- light-theme overrides;
- enterprise light overrides;
- typography compatibility layers;
- Electron/desktop-specific styling;
- later surface-finish overrides.

Broad `!important` typography and light-theme rules enforce consistency across old utility classes and inline styles. This improves visual parity but makes cascade order an implicit dependency. A local component change can be overridden by a later global layer.

`design-qa.md` and dated research/implementation notes document iterations, but some decisions are explicitly superseded. They are history, not a single current design specification.

---

## 16. Electron desktop implementation

The desktop runtime includes:

- a sandboxed renderer and restricted preload bridge;
- custom window chrome and desktop shell controls;
- guarded file/dialog operations;
- guarded external URL opening;
- broker-network and WebSocket Origin handling;
- update/release integration;
- environment/mode-specific backend configuration;
- NSIS packaging and installer metadata.

Positive security characteristics include a narrow renderer bridge and validation around privileged actions. Important concerns include:

- renderer tokens still ultimately interact with browser-like storage paths;
- suppressed console/error/rejection output can conceal failures;
- desktop and web environment aliases can drift;
- updater/release behavior must be tested against the separate public release repository.

The active Electron release workflow builds/publishes installers. This is distinct from the web deployment workflow.

---

## 17. Deployment, API contract, and documentation state

### 17.1 Web deployment

`docs/deploy-web-terminal.md` describes automated deployment from the main branch. However, `.github/workflows/deploy.yml` is entirely commented out, so the documented automatic web deployment is not active in this checkout.

The deploy helper script and Docker configuration exist, but their presence does not make the disabled workflow operational.

### 17.2 Electron release

Electron release automation is active and targets the separate public release repository configured in `package.json`. Desktop publishing has real external side effects and should only be invoked intentionally.

### 17.3 Swagger

`swagger.yaml` is broad and describes substantially more backend functionality than the active frontend consumes. It also contains mojibake and conflicting/stale contracts. Examples include WebSocket authentication descriptions that mix query-token and auth-frame expectations, and order schemas that do not fully express the newer durable lifecycle/revision requirements described in incident/fix documents.

Swagger is therefore useful for endpoint discovery, but it is not sufficient proof of the currently deployed backend contract.

### 17.4 README and historical prompts

- The root README is obsolete relative to the current architecture and ends with corrupted text.
- Backend/frontend fix prompts document desired contracts and known incidents; they are not executable implementation.
- `WEBSOCKET_MARKET_ORDER_IMPLEMENTATION.md` and similar documents may lag subsequent code changes.
- Historical QA artifacts and screenshots must not be presented as a current pass result.

---

## 18. Legacy, demo, and maintenance code

### 18.1 Examples and old pages

Several examples and dashboards are disconnected from the active runtime. Common issues include:

- stale service method signatures;
- hard-coded localhost endpoints or dates;
- broad `any` casts;
- global DOM/canvas queries;
- alert/console side effects;
- typoed utility classes;
- static/sample data;
- one async React effect whose returned cleanup is never registered.

These files are useful references but should not dictate active architecture without modernization.

### 18.2 Standalone HTML

- theme/dashboard HTML files are isolated previews;
- `websocket-test.html` targets obsolete/local contracts, contains hard-coded demo credentials, and logs part of a received token;
- standalone files do not inherit the active API/session safety logic.

The diagnostic credentials/token logging should be removed or replaced with operator-supplied local input if the file is retained.

### 18.3 Maintenance scripts

- locale generators can destructively overwrite catalogs;
- icon migration scripts perform broad regex-based rewrites;
- the PowerShell icon migration script includes an old hard-coded developer path;
- scratch diffs are historical and encoding-damaged;
- benchmark scripts may require a live configured backend.

These should be treated as one-off tools, reviewed before execution, and ideally moved behind dry-run checks.

### 18.4 MQL5 code

`LastSymbolTrader.mq5` and `LastSymbolTraderPro.mq5` are standalone MetaTrader Expert Advisors related to last-symbol trading behavior. They are ancillary to the web/Electron runtime and have their own MetaTrader execution/environment assumptions.

### 18.5 Antigravity preview bridge

The project includes scripts and a small local extension bridge for editor preview integration. It is development tooling, not production terminal runtime.

---

## 19. Confirmed strengths and invariants to preserve

### 19.1 Exact broker symbol identity

Never strip suffixes/dots or guess execution symbols. Display normalization must remain separate from trading identity.

### 19.2 Broker/account/session isolation

Async responses, socket frames, latency samples, drawings, chart state, and trading actions must not cross broker/account epochs.

### 19.3 One idempotency key per order intent

Generate one UUID-v4 and reuse it throughout WebSocket, REST, and status recovery. Never create a second order after a send becomes uncertain.

### 19.4 Source-time freshness

Use broker/source timestamps and sequence/revision information. Browser arrival order alone is not reliable.

### 19.5 Backend authority for financial truth

Balance, equity, margin, free margin, account status, and final execution state should come from durable backend/broker truth. Client calculations may be estimates but must not overwrite authoritative state.

### 19.6 Chart price integrity

Do not rescale, fabricate, or silently “repair” incompatible OHLC. Reject mixed bands and expose diagnostics.

### 19.7 Stable chart hosts

Window arrangement must preserve chart instances and pane identity wherever possible.

### 19.8 Drawing isolation and scope

Do not alter drawing code for unrelated requests. Preserve chart/symbol/timeframe/account context keys and local persistence behavior.

### 19.9 Definite-unsent fallback rule

REST create is safe only if the WebSocket order was definitely not sent or if the request shape cannot be sent by that socket path. Otherwise recover by client ID.

---

## 20. Findings and risk register

### High priority

#### H1. Credential storage does not meet the stated secure-storage requirement

**Evidence:** token and routing reads/writes use `localStorage`/`sessionStorage` in session/API paths.  
**Risk:** XSS or compromised renderer context can access long-lived credentials.  
**Direction:** use a server-set Secure/HttpOnly/SameSite refresh cookie or BFF model for web; use OS-backed credential storage behind a narrow Electron IPC API for desktop; keep access tokens short-lived/in-memory where feasible.

#### H2. Failed New Order submission can close as if successful

**Evidence:** `OrderPanelDialog` closes after its callback resolves; `App.handleOrderPanelSubmit` catches and does not reject.  
**Risk:** user loses the error context and may believe an order was accepted.  
**Direction:** rethrow after feedback and add a dialog regression test.

#### H3. Unresolved order commands are not durable across process restart

**Evidence:** command recovery ownership is process-memory based.  
**Risk:** backend may execute an order after the client forgets it; UI status becomes ambiguous.  
**Direction:** persist and rehydrate a session-scoped unresolved-command ledger.

#### H4. Client timeout can be mislabeled as terminal expiration

**Evidence:** polling creates an `expired` result at deadline, including after failed final status reads.  
**Risk:** false terminal certainty can hide a later fill.  
**Direction:** distinguish backend-confirmed expiration from client timeout/unknown and continue safe reconciliation.

#### H5. Portfolio updates lack one shared monotonic revision

**Evidence:** several REST/socket/local writers update overlapping state.  
**Risk:** stale snapshots can replace newer portfolio truth.  
**Direction:** require and enforce account/portfolio revision ordering.

### Medium priority

#### M1. Oversized orchestrators

`App.tsx`, `TradingChart.tsx`, `BottomDock.tsx`, and `drawingManager.ts` combine many concerns. This increases regression probability and makes ownership difficult to trace.

#### M2. Multiple overlapping API/transport layers

`src/api/client`, `brokerApi`, `src/services/api`, gateway code, FIX code, and socket managers have legitimate differences but duplicate routing/auth/error concerns.

#### M3. Electron error suppression

Suppressing console methods and global renderer errors can hide production failures and weaken support diagnostics.

#### M4. TypeScript safety is relaxed

The application TS config uses `strict: false`, permits JavaScript, and excludes test files. Vitest compiles/discovers tests separately, so a normal app typecheck does not validate all test code.

#### M5. Documentation and deployed-contract drift

README, Swagger, deployment docs, fix prompts, and implementation documents do not form one reliable source of truth.

#### M6. Web deploy workflow is disabled

Documentation suggests automation that the commented workflow does not provide.

#### M7. Locale quality/encoding defects

Catalog shape is tested, but translation correctness and encoding are not.

#### M8. Production-visible diagnostic hook

`window.testBlowup` mutates account state and should be gated to development/test builds.

#### M9. Pending UI cleanup is time-based

The 120-second orphan cleanup can remove UI evidence without proving backend terminal status.

### Lower priority/maintenance debt

- broad CSS override layers and `!important` use make cascade order fragile;
- many advanced/demo components live beside active components without a clear status boundary;
- destructive locale/icon scripts lack strong routine safety;
- standalone diagnostics have stale URLs/contracts;
- historical scratch patches and generated QA output add repository noise;
- active workflow, release, and environment documentation need consolidation.

---

## 21. Recommended remediation plan

### Phase 0 — protect correctness and credentials

1. Fix New Order rejection propagation and add regression coverage.
2. Design durable order-command recovery with explicit `unknown` versus backend-confirmed terminal states.
3. Move refresh credentials out of JavaScript-readable storage.
4. Remove committed diagnostic credentials and token logging from `websocket-test.html`.
5. Gate/remove `window.testBlowup` outside development.

### Phase 1 — establish authoritative state contracts

1. Add backend portfolio/account revisions and field-presence semantics.
2. Apply one revision gate across App, sockets, toolbox refreshes, and local-close reconciliation.
3. Document exact WebSocket auth, channels, event schemas, and order lifecycle in one versioned contract.
4. Reconcile Swagger with the deployed contract.

### Phase 2 — reduce frontend ownership overlap

1. Extract session lifecycle from `App.tsx`.
2. Extract portfolio reconciliation and order orchestration behind tested state machines/services.
3. Split chart transport/data ownership from chart rendering and interaction.
4. Keep drawing subsystem isolated; refactor it only under drawing-specific work.
5. Consolidate API authentication/routing/error behavior while preserving transport-specific logic.

### Phase 3 — improve reliability and maintainability

1. Turn on stricter TypeScript options incrementally for high-risk trading/session modules.
2. Make test typechecking explicit.
3. Add translation encoding/quality checks.
4. Replace broad theme overrides gradually with semantic tokens/components.
5. Move demos/examples/one-off scripts into clearly labeled legacy or tooling boundaries.
6. Update README and deployment documentation.
7. Either restore a real web workflow or state clearly that deployment is manual.

---

## 22. Verification guidance for future changes

No commands below were run during the audit. They are the repository-provided or appropriate verification paths.

### 22.1 Baseline checks

```text
npm run typecheck
npm run lint
npm run test:run
npm run build:web
```

Because the app TypeScript project excludes tests, `npm run typecheck` is not a replacement for Vitest.

### 22.2 Order-lifecycle changes

Run focused suites first, then the full suite:

```text
npx vitest run src/api/tradeSocket.orders.test.ts src/services/api.market-order-ws.test.ts src/services/orderCommandLifecycle.test.ts src/hooks/useToolboxTradeData.lifecycle.test.tsx
npm run test:run
```

A live order benchmark must not be treated as a unit test and should only be run against an explicitly approved non-production account/backend.

### 22.3 Session/auth changes

Prioritize broker session, API refresh, startup handoff, login runtime, logout transition, and App shell tests. Verify web and Electron separately because their storage/network boundaries differ.

### 22.4 Chart/market-data changes

Run exact-symbol, freshness, candle history/aggregation, socket, chart-price-guard, selection, interaction, and affected `TradingChart` contract tests. Then build and manually verify multiple broker symbol formats and market-closed behavior.

### 22.5 Dock/drawing changes

Run dock arrangement/chart-panel/store tests for workspace work. For drawing-specific work, run the complete drawing manager and drawing-tools suites because geometry changes can affect unrelated tools.

### 22.6 Electron changes

```text
npm run build:electron
npm run electron:build
```

Packaging creates installer artifacts. Publishing has external side effects and must not be run unless explicitly intended.

### 22.7 Scripts not safe to run casually

Do not run locale generators, broad icon migrations, Electron publishing, or live order benchmarks as generic validation. Review inputs, output paths, credentials, and dry-run behavior first.

---

## 23. Safe change guide for future maintainers

Before editing:

1. inspect `git status` because the working tree may contain unrelated work;
2. reopen the exact current implementation and adjacent tests;
3. determine whether the file is active runtime, legacy/demo, generated, or historical documentation;
4. identify the broker/account/session scope used by the flow;
5. preserve exact symbol identity and source timestamps;
6. for orders, determine whether a request is definitely unsent or may have been sent;
7. for account data, identify all competing state writers;
8. for charts, identify the exact pane/host and interaction owner;
9. avoid drawing files unless the request is drawing-specific;
10. run focused tests before broad checks.

After editing:

1. review the diff for accidental environment, generated, or artifact changes;
2. run the narrow affected tests;
3. run typecheck/lint/build as appropriate;
4. run the full Vitest suite for cross-cutting changes;
5. manually verify both anonymous and authenticated paths when startup/market data changes;
6. manually verify web and Electron when network/storage/window behavior changes;
7. update only authoritative documentation, clearly labeling desired future contracts.

---

## 24. Final assessment

The repository contains a sophisticated and substantially implemented broker terminal with strong work in charting, exact-symbol semantics, market-data freshness, multi-chart retention, drawing breadth, and duplicate-order avoidance. It also carries the complexity of several generations of architecture, UI experiments, documentation, and maintenance scripts in one tree.

The project should not be described as incomplete merely because many optional tools are disconnected; the core terminal, guest data, authenticated data, charting, account display, and trading paths are real. Conversely, code presence alone must not be used to claim every analytics/admin/AI component is production-connected.

The highest-value next work is not adding more surface area. It is making trading and account truth durable and unambiguous: secure credentials, propagate failed submissions correctly, persist unresolved order commands, distinguish timeout from terminal expiration, and enforce monotonic portfolio revisions. After those correctness boundaries are established, reducing orchestrator size and consolidating contracts will make future feature work safer.

---

## 25. Audit status statement

- Authored readable code/configuration/tests/docs were reviewed file by file in the stated scope.
- Generated dependencies, builds, binary assets, and bulk generated visual material were inventoried rather than treated as authored source.
- Sensitive environment values are not included.
- The audit did not modify application code.
- The audit did not run tests, builds, lint, typecheck, packaging, deployment, or live trading.
- Existing QA screenshots, notes, and test source are not presented as fresh execution evidence.
- This report describes the local working-tree snapshot as read on 2026-09-16.
