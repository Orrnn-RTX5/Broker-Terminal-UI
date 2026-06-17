# Electron GitHub Release Setup

This project publishes the desktop updater feed to a separate public GitHub repository.

- Private source repo: `rtx5-orrnn/rtx5-broker-webterminal-ui`
- Public release repo: `rtx5-orrnn/rtx5-terminal-releases`
- Electron main file: `electron.cjs`
- Windows installer target: NSIS
- Release tool: `electron-builder`
- Updater runtime: `electron-updater`
- Publish script: `npm.cmd run electron:publish`
- Release workflow: `.github/workflows/electron-release.yml`

The public release repo is intentional. Installed customer apps must be able to download `latest.yml` and the installer without a GitHub token.

## Current State

Configured:

- `package.json` has `main: "electron.cjs"`.
- `package.json` has `electron:build` and `electron:publish` scripts.
- `package.json` publishes to `rtx5-orrnn/rtx5-terminal-releases`.
- `package.json` has `"private": false` under `build.publish`.
- `electron.cjs` checks for updates after startup and every 60 minutes.
- `build/icon.ico` exists for the Windows installer.
- `.github/workflows/electron-release.yml` builds on `windows-latest`.
- The workflow uses the private source repo secret named `RELEASE_GH_TOKEN`.
- The workflow initializes the public release repo with a README if it has no branches yet.

Still required before each release:

- `package.json` version must be bumped and pushed to `main`.
- The workflow must be run manually with the same version.
- The release repo must remain public.

## Token Location

Store the GitHub token only in the private source repo:

```text
rtx5-broker-webterminal-ui
Settings
Secrets and variables
Actions
New repository secret
```

Secret name:

```text
RELEASE_GH_TOKEN
```

Do not store the token in:

- `package.json`
- `.env`
- `.env_local`
- `.env.web`
- `brokers.json`
- Any committed file
- The public release repo

## Token Permissions

Classic token:

- `public_repo` is enough if it only needs to publish to the public release repo.
- `repo` also works, but it is broader than needed.

Fine-grained token:

- Repository access: `rtx5-orrnn/rtx5-terminal-releases`
- Repository permissions: `Contents: Read and write`

The installed desktop app does not need this token. The token is only for GitHub Actions to upload release assets.

## Release Version Rule

Every Electron release must use a new `package.json` version.

Patch release example:

```powershell
npm.cmd version patch --no-git-tag-version
```

Check the version:

```powershell
node -p "require('./package.json').version"
```

Use semantic versions:

- Patch: bug fixes, example `1.0.16` to `1.0.17`
- Minor: new features, example `1.0.16` to `1.1.0`
- Major: breaking changes, example `1.0.16` to `2.0.0`

## Recommended Release Flow

1. Make sure the repo is clean.

```powershell
git status --short --branch
```

2. Pull the latest `main`.

```powershell
git pull --ff-only origin main
```

3. Install dependencies.

```powershell
npm.cmd ci
```

4. Run validation locally.

```powershell
npm.cmd run typecheck
npm.cmd run test:run
npm.cmd run build:electron
```

5. Bump the version.

```powershell
npm.cmd version patch --no-git-tag-version
```

6. Commit and push the version bump.

```powershell
git add package.json package-lock.json
git commit -m "Release desktop vX.Y.Z"
git push origin main
```

Replace `X.Y.Z` with the actual version.

7. Open the private source repo on GitHub.

```text
https://github.com/rtx5-orrnn/rtx5-broker-webterminal-ui/actions/workflows/electron-release.yml
```

8. Click **Run workflow**.

Inputs:

```text
version = X.Y.Z
```

The input version must exactly match `package.json`.

9. Wait for the workflow to finish.

The workflow will:

- Install dependencies.
- Confirm `RELEASE_GH_TOKEN` exists.
- Confirm the requested version matches `package.json`.
- Confirm Electron publish config targets `rtx5-orrnn/rtx5-terminal-releases`.
- Run typecheck.
- Run tests.
- Build the Windows app.
- Publish release assets to the public release repo.

10. Verify the public release.

Open:

```text
https://github.com/rtx5-orrnn/rtx5-terminal-releases/releases/tag/vX.Y.Z
```

Expected assets:

- `RTX.Terminal.Setup.X.Y.Z.exe`
- `RTX.Terminal.Setup.X.Y.Z.exe.blockmap`
- `latest.yml`

Check:

- The release is not draft.
- `latest.yml` exists.
- The installer asset exists.
- The installer filename in `latest.yml` exactly matches the uploaded `.exe`.
- Asset download URLs work without login.

11. Test desktop update.

Install the previous released version first, then publish the new version. Open the app and confirm:

- The update check runs after startup.
- The update banner/status appears.
- Download reaches 100 percent.
- Install/restart moves the app to the new version.

## Manual Local Publish

Use this only for emergency publishing from your own Windows machine.

1. Set the token for the current PowerShell session.

```powershell
$env:GH_TOKEN="YOUR_GITHUB_TOKEN"
```

2. Publish.

```powershell
npm.cmd run electron:publish
```

3. Clear the token from the session when finished.

```powershell
Remove-Item Env:\GH_TOKEN
```

Do not paste the token into any committed file.

## Production Safety Checklist

Before every release:

- Source repo `main` is clean.
- `package.json` version is higher than the currently installed version.
- `npm.cmd run typecheck` passes.
- `npm.cmd run test:run` passes.
- `npm.cmd run build:electron` passes.
- GitHub Actions workflow succeeds.
- Public release repo contains `latest.yml`.
- `latest.yml` points to the exact installer filename.
- Release assets download without login.
- Desktop update is tested from previous version to new version.

## Troubleshooting

`RELEASE_GH_TOKEN repository secret is required`

- Add `RELEASE_GH_TOKEN` in the private source repo Actions secrets.
- Do not add it to the public release repo.

`package.json version does not match requested release`

- The workflow input version must match `package.json`.
- Bump and push `package.json` first, then rerun the workflow.

`Electron publish config must target public repo`

- Confirm `package.json` has:

```json
"publish": {
  "provider": "github",
  "owner": "rtx5-orrnn",
  "repo": "rtx5-terminal-releases",
  "private": false,
  "releaseType": "release"
}
```

`latest.yml` missing

- The release was not published through `electron-builder --publish always`.
- Rerun the Electron release workflow.

`422 Repository is empty`

- GitHub cannot create a release in a completely empty repository.
- The workflow has an initialization step that creates the first `main` commit in `rtx5-orrnn/rtx5-terminal-releases` if needed.
- If this still appears, confirm `RELEASE_GH_TOKEN` has write access to the public release repo.

Updater sees no update

- Confirm the installed app version is lower than the released version.
- Confirm the release is not draft.
- Confirm `latest.yml` is downloadable from the public release repo.
- Confirm the app is reading `rtx5-orrnn/rtx5-terminal-releases` as the update feed.

Download fails

- Confirm the release repo is public.
- Confirm release assets download without GitHub login.
- Confirm the installer filename matches the `latest.yml` path exactly.

Installer downloads but does not install

- Close all running instances of the app.
- Check for existing app processes in Task Manager.
- Reopen the app and trigger update again.

## Notes

- The private source repo can stay private.
- The public release repo should contain release assets only.
- Do not publish source code to the release repo.
- Do not put GitHub tokens into the desktop app.
