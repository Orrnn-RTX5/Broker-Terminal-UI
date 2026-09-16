# Desktop account popup CSS fix

The shared 14px typography had outgrown the desktop account menu's 11px badge and compact account summary. The fix keeps the shared body and heading roles while giving the popup enough space.

- A 280px popup clamps to the viewport.
- Account name and broker appear on separate wrapping lines.
- The account heading aligns with the account ID, with its extra nested padding removed.
- The saved-account badge uses a dedicated 10px role inside a 16px pill, including `99+`.
- Menu rows have consistent padding, and Log out retains the shared loss color in light mode.

## Validation

- Electron build (TypeScript and Vite) passed.
- All 22 existing account-action, desktop-menu, and light-theme tests passed.
- `verify.cjs` renders the real `DesktopQuickActions` React component with the built CSS in an isolated hidden native Electron window. Only translation is replaced with English fixture text; there is no real account or network activity.
- `verification.json` confirms normal/small/large text sizes, heading weight, badge and menu bounds, full metadata wrapping, aligned headings, loss color, and working account/logout callbacks.
- `desktop-account-normal.png` and `desktop-account-large.png` were visually inspected.

The screenshots show fixture account details, not an authenticated desktop session. The package verification script checks the installed files separately.

## Installed desktop build

The Windows installer was rebuilt locally with `electron-builder --win --publish never` and installed silently over the existing 1.0.25 installation on September 15, 2026. The installer exited with code 0; the existing NSIS update flow retains app data.

`verify-package-installed.json` confirms that the installed archive matches the rebuilt package SHA256 and that all 11 checked files (including the App JavaScript containing the popup and all compiled stylesheets) exactly match the tested build. No release was published.
