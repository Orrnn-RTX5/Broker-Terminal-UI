# RTX5 Antigravity Preview Bridge

This local extension lets a terminal process open a loopback development URL
inside Antigravity's built-in Jetski Preview. It listens on a workspace-specific
Windows named pipe, so opening a preview does not rely on keyboard automation or
the foreground application.

The bridge accepts only `http` or `https` URLs on loopback hosts and only for an
open workspace whose normalized path matches the request.

From the project root, install it once with `npm run dev:editor:install`, reload
the Antigravity window once, and then use `npm run dev:editor`. The terminal
wrapper starts Vite and opens the actual selected port in Jetski Preview.
Each origin gets its own retained editor tab, so previews on ports 5173 and
5174 can remain open at the same time.
