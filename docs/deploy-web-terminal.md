# RTX5 web terminal deployment

The active workflow is `.github/workflows/deploy.yml`. It builds and pushes the web image on every push to `main` and on manual dispatch. Deployment runs only for `refs/heads/main`.

## Delivery path

1. GitHub Actions builds `Dockerfile` with `VITE_MODE=web`.
2. The image is pushed to GHCR with immutable commit-SHA and mutable `latest` tags.
3. The deploy job connects to the configured server and recreates `broker-terminal-ui` on `127.0.0.1:8103`.
4. `docker-entrypoint.sh` merges explicit deployment overrides into the immutable built runtime configuration and embeds the result before nginx starts.

The container serves nginx on port `80`; the host reverse proxy owns the public hostname and TLS configuration.

## Required configuration

Configure these repository secrets for production:

| Secret | Purpose |
| --- | --- |
| `SERVER_SSH_KEY` | SSH private key. `BROKER_SSH_PRIVATE_KEY` is the compatibility fallback. |
| `SERVER_HOST` | Required deployment host. The workflow has no default. |
| `SERVER_USER` | SSH user. |
| `SERVER_PORT` | SSH port. |
| `GHCR_USERNAME` | Optional explicit GHCR login user. |
| `GHCR_TOKEN` | Optional explicit GHCR token. |
| `PROD_ENV_FILE` | Complete production runtime environment file. `ENV_FILE` is the compatibility fallback. |

If no environment-file secret is supplied, the workflow reuses an existing `/opt/Rtx5-broker-production/terminal-ui/.env` when present. Treat that behavior as an operational fallback, not as proof that the deployed broker configuration is current.

Never commit authentication tokens or privileged feed credentials. Browser variables prefixed with `VITE_` are delivered to the client and cannot be treated as secrets.

## Local validation

Build the same renderer mode used by the image:

```powershell
npm.cmd ci
npm.cmd run build:web
npx.cmd vite preview --mode web --host 127.0.0.1 --port 5175 --strictPort
```

When Docker is available, verify the complete runtime image:

```bash
docker build --build-arg VITE_MODE=web -t rtx5-webterminal:local .
docker run --rm --name rtx5-webterminal-local -p 127.0.0.1:8082:80 rtx5-webterminal:local
```

Check both the document and generated configuration:

```bash
curl -fsS http://127.0.0.1:8082/ > /dev/null
curl -fsS http://127.0.0.1:8082/runtime-config.js
```

Confirm the exact expected broker ID, API origin, WebSocket origin, discovery origin, and MT5 server. An HTTP 200, container health, WebSocket upgrade, or subscription acknowledgement alone does not prove authenticated readiness or fresh prices for a symbol.

Deployment environment values are sparse overrides. Supplying only `BROKER_ID`,
for example, preserves the API, WebSocket, discovery, and MT5 settings built into
the image; it also keeps the browser broker aliases consistent. The entrypoint
fails before publishing when the immutable built runtime template is missing,
empty, unsafe to inline, or cannot be inserted exactly once. Rebuild the whole
image whenever the entrypoint or its templates change.

## Release caveats

The current workflow is active, but it is not yet a complete production-safety gate:

- Its automatic rollback restores the previous local image ID. This protects the image selection, but the same environment file is reused; keep environment changes backward-compatible or manage a separately versioned configuration rollback.
- Its health check validates only HTTP 200 at `/`; it does not validate the generated broker configuration or authenticated application readiness.
- SSH currently uses `StrictHostKeyChecking=accept-new`; production should pin the expected host key.

Resolve those controls before treating a successful workflow run as release certification.
