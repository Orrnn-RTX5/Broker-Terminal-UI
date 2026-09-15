# Desktop broker selection verification

The desktop login loads `GET https://superbackend.orrnn.com/api/v2/broker/servers` from the discovery base configured in `.env.electron`. `.env.web` continues to control the web deployment.

Selecting a directory broker updates its displayed name, logo and existing broker artwork, clears the password when switching brokers, and checks the exact published `server_url` at `/health`. Account/password input and Login are enabled after that server responds successfully. Login uses `POST {server_url}/api/v2/auth/login`; the successful session retains the selected broker's routing and name.

Directory errors, empty directories, suspended entries, invalid URLs, failed health checks and timeouts cannot fall back to the configured Achiever server for desktop authentication. Retry is available for directory and health failures. Cancelled or late health responses cannot enable login for a different broker, and selection is locked while authentication is in flight.

## Current backend result

On September 12, 2026, the live public directory returned only **Achiever Financials** (`achiever-financials`). Its exact server, `https://service.achieverfinancials.com`, returned HTTP 200 from `/health`. GTA and MyProp must be included as available entries by Superadmin before they can appear in the real desktop list.

## Validation

- 67 focused login, discovery, branding and startup tests passed.
- 135 API routing, session, WebSocket, handoff, logo and style regression tests passed.
- `npm run build:electron` passed TypeScript compilation and desktop bundling.
- `npx electron-builder --win --publish never` produced `draft/RTX.Terminal.Setup.1.0.25.exe` (112,937,711 bytes). `package-verification.json` confirms the packaged entry files match the tested build and records the installer hash. This is a local installer; it was not published or installed over the running app.
- `verify-electron.cjs` runs the built renderer with the real preload in an isolated Electron session. `verification.json` records live directory/health results and simulated broker switching, login request routing and authenticated terminal handoff.
- Screenshots prefixed `fixture-` use simulated directory/server responses. Logo responses in those fixtures use the local RTX icon. They do not prove GTA/MyProp availability or real-account authentication.

No real account credentials were supplied. Authenticated entry was verified with intercepted test responses; no test credentials or trading requests were sent to live brokers.

Run the Electron verification from PowerShell after building:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
node_modules\.bin\electron.cmd artifacts\desktop-broker-login-20260912\verify-electron.cjs
```

The test uses its own local profile and an in-memory session partition. It does not use the installed app's account storage.
