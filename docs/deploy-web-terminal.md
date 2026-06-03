# RTX5 Web Terminal Deployment

This repository deploys the Web Terminal frontend to broker hosts from GitHub Actions on pushes to `main`.

The workflow validates the web build with `npm run build:web`, then builds and pushes the runtime image from the committed `Dockerfile` with `VITE_MODE=web`. The committed nginx config serves the container on port `80`; broker hosts keep the public app binding on `127.0.0.1:8081`.

## Broker Metadata

`brokers.json` contains enabled broker targets. The Grow Trading Academy target uses:

| Field | Value |
| --- | --- |
| Broker ID | `grow-trading-academy` |
| Domain | `webterminal.growtradingacademy.com` |
| Web Terminal app port | `127.0.0.1:8081` |

Keep the Manager UI on port `8080`; the Web Terminal deployment is intentionally bound to `127.0.0.1:8081` behind nginx.

For environment-specific broker metadata, set the `BROKERS_JSON` repository secret to the full JSON document. If the secret is empty, the workflow uses the committed `brokers.json`.

## Required GitHub Secrets

| Secret | Purpose |
| --- | --- |
| `BROKER_SSH_PRIVATE_KEY` | Private SSH key that can log in to each enabled broker host. |
| `GHCR_USERNAME` | GitHub username or bot account used for GHCR login. |
| `BROKERS_JSON` | Optional override for `brokers.json`. |

The workflow uses the built-in `GITHUB_TOKEN` to push `ghcr.io/<owner>/<repo>:<sha>` and `ghcr.io/<owner>/<repo>:latest`.

## Host Requirements

The SSH user should have root privileges on an Ubuntu host. The deploy script installs or configures:

- Docker
- nginx
- certbot and the nginx certbot plugin
- `/etc/nginx/rtx5-managed/*.conf` included from the nginx `http` block
- A vhost for `webterminal.growtradingacademy.com` with HTTPS redirect, Let's Encrypt certificates, reverse proxying, and WebSocket headers

## Validate Deployment

After a successful workflow run:

```bash
curl -I https://webterminal.growtradingacademy.com/
ssh root@webterminal.growtradingacademy.com 'docker ps --filter name=rtx5-webterminal-grow-trading-academy && nginx -t'
```

Expected results:

- `curl` returns an HTTPS response.
- The Docker container is running and bound to `127.0.0.1:8081`.
- `nginx -t` reports a valid configuration.
