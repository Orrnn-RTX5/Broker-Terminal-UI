# Desktop New Order crash verification

Verified on 2026-09-15 in the existing authenticated Electron development app, loading this repository's `dist/index.html`.

## Cause and fix

The app started at 16:33:15 and its distribution files were rebuilt at 16:48:48. Opening New Order requested the previous build's dialog JavaScript file. The native DevTools console confirmed `net::ERR_FILE_NOT_FOUND`; the React root was empty. See `missing-order-module.png` and `desktop-console-before.png`.

New Order now imports directly into the authenticated App, so opening it requires no additional dialog JavaScript or CSS file. A local ErrorBoundary also contains ticket rendering failures. Login still loads App after authentication.

## Validation

- TypeScript and the Electron Vite build completed successfully; see `build-electron.log`. PowerShell represented Vite warning output as NativeCommandError, but the log ends with a successful build. No separate OrderPanelDialog asset remains.
- 22 focused tests passed: 11 order dialog tests, 10 startup contracts, and 1 error containment/retry test.
- Reloaded the existing desktop window with the rebuilt files and its saved session.
- Clicked the actual New Order toolbar button: XAUUSD ticket and live tick chart rendered; terminal and title bar remained visible. See `desktop-new-order-button.png`.
- Closed the ticket, pressed F9, and confirmed it reopened. See `desktop-new-order-f9.png`.
- Closed the ticket and left the terminal running. No order was submitted. See `desktop-restored.png`.

This verifies the repository's running desktop app. No installer was produced or published.
