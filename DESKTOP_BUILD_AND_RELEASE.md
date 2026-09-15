# Desktop .exe Build & Release Guide (Windows)

This project (RTX Terminal) runs two ways: as a web terminal in the browser, and as a
Windows desktop app (Electron). After you change code, follow the steps below to
(1) make the desktop .exe and (2) release the latest version to users.

---

## Copy-paste commands (fast path)

First check your terminal: if the prompt line starts with `PS C:\...` you are in
**PowerShell**; if it shows `C:\...>` without `PS` you are in **cmd**.
Old PowerShell on Windows does NOT understand `&&` — it gives the error
"The token '&&' is not a valid statement separator" — so use the `;` versions below.

### PowerShell (prompt starts with `PS`) — the usual Windows terminal

Make the .exe:

```
npm install; npm run electron:build
```

Result: `draft/RTX.Terminal.Setup.<version>.exe` (number = version in package.json).

Optional — put the .exe in your File Explorer Downloads folder as well:

```
Copy-Item .\draft\RTX.Terminal.Setup.<version>.exe $env:USERPROFILE\Downloads\
```

(cmd terminal instead: `copy /b draft\RTX.Terminal.Setup.<version>.exe %USERPROFILE%\Downloads\`)

Release:

```
$env:GH_TOKEN="PASTE_YOUR_GITHUB_TOKEN_HERE"; npm version patch --no-git-tag-version; npm run electron:publish
```

### cmd (prompt like `C:\Users\...>`)

Make the .exe:

```
npm install && npm run electron:build
```

Release:

```
set "GH_TOKEN=PASTE_YOUR_GITHUB_TOKEN_HERE" && npm version patch --no-git-tag-version && npm run electron:publish
```

### What the release command does, in order

1. Sets your GitHub token for this terminal session only.
2. Bumps the version in `package.json` (e.g. 1.0.24 → 1.0.25) without creating a git commit or tag.
3. Builds the .exe and uploads it (with `latest.yml`) to GitHub Releases.

Note: with `;` (PowerShell) the next part still runs if an earlier part fails,
so read the output — if you see an error, stop and fix it before continuing.

### The parts that are NOT commands (do these by hand)

Before running the release command:

- Create the GitHub token once: GitHub → Settings → Developer settings → Personal access tokens (needs permission to publish releases in `rtx5-orrnn/rtx5-terminal-releases`).
- Commit and push your code changes (`git add`, `git commit`, `git push`).

After running the release command:

- Open <https://github.com/rtx5-orrnn/rtx5-terminal-releases/releases> and check the new version is listed.

Everything else (build, version bump, upload) is covered by the commands above.
The detailed step-by-step sections below explain each part if you ever need them.

---

## Section 1 — Build the .exe file (for yourself / for testing)

1. Open a terminal in this project folder.
2. Run `npm install` — only needed once, or after dependencies in `package.json` change.
3. Run:

   ```
   npm run electron:build
   ```

   What it does: builds the app (`vite build --mode electron`), then packages it with
   electron-builder for Windows.
4. When it finishes, your installer is in the **`draft`** folder:

   ```
   draft/RTX.Terminal.Setup.<version>.exe
   ```

   Example: if `package.json` has `"version": "1.0.24"`, you get
   `draft/RTX.Terminal.Setup.1.0.24.exe`.
5. Double-click that .exe on a Windows PC to install and test your changes.

Notes:

- The number in the .exe name always comes from the `"version"` field in `package.json`.
- If the build stops with an icon error: put your icon file at `build/icon.ico`
  (this file is currently missing in the repo), then run step 3 again.
- Only Windows is packaged (`--win`). No macOS/Linux installers are configured.

---

## Section 2 — Release the latest version (publish for users + auto-update)

1. Commit and push your code changes first (`git add`, `git commit`, `git push`).
2. Bump the version in `package.json`, e.g. `"1.0.24"` → `"1.0.25"`.
   Every release needs a NEW version number, otherwise installed apps will not
   auto-update.
3. Set your GitHub token in the terminal (Windows cmd):

   ```
   set GH_TOKEN=your_github_token
   ```

   (In PowerShell use: `$env:GH_TOKEN="your_github_token"`)
   The token must be allowed to publish releases in the
   `rtx5-orrnn/rtx5-terminal-releases` repository.
4. Run:

   ```
   npm run electron:publish
   ```

   What it does: same build as Section 1, then uploads the .exe and `latest.yml`
   to GitHub Releases.
5. Check the release page:
   <https://github.com/rtx5-orrnn/rtx5-terminal-releases/releases>
   Your new version's .exe should be listed there.
6. Users:
   - New users download the .exe from that Releases page and install it.
   - Apps already installed on their PCs update themselves automatically
     (electron-updater checks that Releases page).

---

## Quick summary

| Command | Result |
| --- | --- |
| `npm run electron:build` | Creates `draft/RTX.Terminal.Setup.<version>.exe` for you to test |
| `npm run electron:publish` | Same .exe uploaded to GitHub Releases for all users + auto-update |

Remember: bump the version in `package.json` before every release, and keep the
`GH_TOKEN` set in the terminal when publishing.
