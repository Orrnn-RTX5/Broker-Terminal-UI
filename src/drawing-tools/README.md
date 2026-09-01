# Drawing tools

This module owns the browser webterminal drawing rail and the context identity used by drawing sessions.

- `WebDrawingToolsRail.tsx` is mounted only when the Electron desktop bridge is absent.
- `toolCatalog.ts` is the single 17-tool catalog for Lines, Channels, and Pitchforks.
- `contextKey.ts` keeps chart ownership, symbol, timeframe, and account scope explicit.
- `geometry/` contains the viewport geometry used by the SVG renderer.

The Electron desktop toolbar must not import or mount the web rail.
