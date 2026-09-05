# Antigravity editor preview

Install the local preview bridge once:

```powershell
npm run dev:editor:install
```

If Antigravity was already running during installation, run **Developer: Reload
Window** once. After that, start the web terminal with:

```powershell
npm run dev:editor
```

The command starts Vite and opens its resolved local URL in Antigravity's
**Jetski Preview** editor tab. Port `5173` is preferred, but Vite automatically
selects `5174`, `5175`, or the next available port when needed. The preview
request uses an authenticated, per-window local named pipe, so Antigravity does
not need to be the foreground application. When the same workspace is open in
more than one Antigravity window, the most recently focused window owns the
preview handoff.

Each origin is opened in its own retained editor tab. For example, a running
5173 preview remains open when a second dev server starts on 5174. Re-running a
URL that is already open focuses and refreshes that port's existing preview tab.

Optional examples:

```powershell
npm run dev:editor -- --port 5174
npm run dev:editor -- --mode desktop
npm run dev:editor -- --port 5173 --strict-port
```

Press `Ctrl+C` in the terminal to stop the corresponding Vite server.

If Antigravity is installed in a non-default location, set `ANTIGRAVITY_CLI` to
the install directory, `Antigravity IDE.exe`, `resources\\app\\out\\cli.js`, or
`bin\\antigravity-ide.cmd` before running the install command.
