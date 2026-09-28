# Drawing tools

This module owns the browser webterminal drawing rail and the context identity used by drawing sessions.

- `WebDrawingToolsRail.tsx` is mounted only when the Electron desktop bridge is absent.
- `toolCatalog.ts` is the single 17-tool catalog for Lines, Channels, and Pitchforks.
- `contextKey.ts` keeps chart ownership, symbol, timeframe, and account scope explicit.
- `model/` contains framework-neutral drawing contracts. Catalogs, geometry, and renderers import types from here rather than from the manager.
- `runtime/` owns mounted chart registration, context-scoped documents/history, global event bindings, and SVG-overlay creation.
- `rendering/` owns axis overlays, trend/channel rendering, regression projection, and legacy stamp glyph definitions.
- `geometry/` contains the viewport geometry used by the SVG renderer.
- `../services/drawingManager.ts` remains the compatibility facade and orchestration layer while rendering and interaction responsibilities are migrated incrementally.

The Electron desktop toolbar must not import or mount the web rail.
