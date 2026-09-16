# Native Electron light-theme parity fixture

**Result: passed.** The current Electron build renders all 49 representative probes with the same font family, font size, font weight, text color and background color under the web and desktop shell classes. Across small, normal and large preferences, all 735 property comparisons match.

The additional role checks passed for each shell: ordinary body and control text is 13 / 14 / 15 px at weight 400, headings and active tabs are weight 500, and the New Order title retains the shared larger dialog role (19 / 20 / 21 px).

## Evidence

- `verification.json`: complete computed values, stylesheet hashes, Electron/Chromium versions, comparison failures (empty), and role failures (empty).
- `fixture-desktop-normal.png`: visually inspected native renderer fixture with the normal preference.
- `fixture-{web,desktop}-{small,normal,large}.png`: all six captures.
- `fixture-{web,desktop}-{small,normal,large}.html`: markup used for each capture.
- `verify-electron.cjs`: repeatable native Electron integration check.

## Scope

Representative markup uses source class names and inline styles from `MarketWatchPanel.tsx`, `NavigatorPanel.tsx`, `BottomDock.tsx`, `MenuBar.tsx`, `TopToolbar.tsx`, `StatusBar.tsx`, `OrderPanelDialog.tsx`, and the shared panel classes. CSS links point to actual `dist/assets` bundles emitted by `npm run build:electron`; expected colors are obtained from the web counterpart rather than copied from an older palette.

Probes cover panel surfaces/titles, Market Watch search/headings/quotes, Navigator labels, Trade and History headings/rows/financial colors, summary metrics, dock tabs, web/desktop menu counterparts including a desktop portal, toolbar controls, chart HUD text, order form and Buy/Sell buttons, and status text.

This is a clearly labeled static fixture rendered by native Electron, not an authenticated terminal or installed-app screenshot. It does not execute application JavaScript or connect to a real account. HTTP, HTTPS and WebSocket requests are blocked. A temporary isolated profile is used, and the window remains hidden/offscreen. Layout-only fixture rules arrange sample components for inspection; typography and colors come from the built CSS.

## Repeat

After `npm.cmd run build:electron`, run from the repository root in PowerShell:

```powershell
$parityElectron = (Resolve-Path 'node_modules/electron/dist/electron.exe').Path
$parityArtifact = (Resolve-Path 'artifacts/desktop-light-parity-20260915').Path
$parityScript = Join-Path $parityArtifact 'verify-electron.cjs'
$parityNodeMode = $env:ELECTRON_RUN_AS_NODE
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
try {
  Start-Process -FilePath $parityElectron -ArgumentList ('"' + $parityScript + '"') -WindowStyle Hidden -Wait -RedirectStandardOutput (Join-Path $parityArtifact 'electron.stdout.log') -RedirectStandardError (Join-Path $parityArtifact 'electron.stderr.log')
} finally {
  if ($null -ne $parityNodeMode) { $env:ELECTRON_RUN_AS_NODE = $parityNodeMode }
}
```

Successful execution writes `passed: true` to `verification.json` and exits with code 0.

The companion package verification script checks that the generated package contains the current build; the second command additionally checks the installed package. These are separate from the renderer fixture:

```powershell
node artifacts/desktop-light-parity-20260915/verify-package.cjs
node artifacts/desktop-light-parity-20260915/verify-package.cjs --installed
```

They write `verify-package.json` and `verify-package-installed.json`, respectively. Run them after packaging or installing as appropriate.

## Local desktop installation

The desktop app was upgraded locally from 1.0.24 to 1.0.25 on September 15, 2026. The older installed package predated the shared typography and light-palette changes; no duplicate desktop theme was needed. The current shared renderer was rebuilt and installed using the existing NSIS upgrade flow, which keeps application data.

- `npm.cmd run build:electron`: passed TypeScript compilation and Vite bundling.
- `npm.cmd exec electron-builder -- --win --publish never`: passed and produced `draft/RTX.Terminal.Setup.1.0.25.exe` (112,947,744 bytes).
- 36 focused typography, desktop-menu, light-theme and font-preference tests passed.
- The silent local installer exited with code 0.
- `verify-package-installed.json`: all 10 requested package files match the current build, all 14 checked typography/palette tokens are present, and the installed archive SHA256 exactly matches the tested package.
- Installed executable: `C:\Users\ADMIN\AppData\Local\Programs\rtx-terminal\RTX Terminal.exe`, product version `1.0.25.0`.

The local installer was not published. The installed archive was verified directly; visual style evidence remains the isolated renderer fixture described above.
