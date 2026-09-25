# Desktop launch splash

Electron shows a splash inside the main desktop window, covering its entire
content area (normally 1400 by 900) while the terminal loads underneath. It uses a large,
centered RTX5 app icon, a short fade-in, and a solid dark background. The icon scales
with the window between 200 and 300 pixels. Reduced-motion preferences disable
the entrance and exit animations.

The logo stays visible for at least 900 ms, then fades away over 240 ms after the
terminal's first paint and a readiness signal from login, the restored terminal,
or an error/recovery screen. The app uses one native window throughout launch.
The splash follows resizing and blocks input to the covered terminal until the
fade completes. A 10-second timeout releases the normal terminal loader if startup
is slow. Closing the window also disposes the splash's web contents. The splash
runs once per native window launch; signing in, signing
out, or refreshing the renderer does not create another splash.

The implementation is in `electron-startup.cjs` and `desktop-splash.html`.
`useDesktopStartupReady` sends the scoped preload signal after a paint opportunity.
It does nothing when the Electron bridge is absent, so web startup is unchanged.
All splash files and the existing icon are included in the desktop package.

Validation:

```powershell
npm.cmd run test:desktop-startup
npm.cmd exec vitest -- run src/startup/useDesktopStartupReady.test.tsx src/startup/TerminalStartupBoundary.test.tsx --pool=threads --maxWorkers=1
npm.cmd run build:electron
npm.cmd run electron:dev
```

Create an installer with `npm.cmd run electron:build`. Building does not update
an already installed copy; run the generated installer to use the new launch flow.
