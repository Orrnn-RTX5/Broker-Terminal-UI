# Documentation index

This directory contains maintained operational, architecture, design, and verification notes for the web and Electron terminal.

## Operations

- [Web deployment](deploy-web-terminal.md)
- [Desktop startup](desktop-startup.md)
- [Electron release](electron-github-release.md)
- [Broker-specific web configuration](deployment/web-broker-setup.md)
- [Broker-neutral image configuration and release verification](deployment/broker-neutral-release.md)
- [Broker API compatibility evidence](deployment/broker-api-compatibility-2026-10-01.md)
- [Editor preview](ANTIGRAVITY_EDITOR_PREVIEW.md)

## Architecture and verification

- [Multi-chart layout](MULTI_CHART_LAYOUT.md)
- [Shortcut verification](SHORTCUT_VERIFICATION.md)
- [Code cleanup record](code-cleanup-2026-09-21.md)
- [Production-readiness audit](production-readiness-2026-09-21.md)
- [Startup performance](startup-performance-2026-09-21.md)
- [Trade placement performance](trade-placement-performance-2026-09-25.md)
- [Backend startup notes](backend-startup-2026-09-21.md)

## Product-specific notes

- [`design/`](design/) contains design research, implementation notes, and visual reference pages.
- [`trading/`](trading/) contains trading behavior and calculation documentation.
- [Daily Change integration](trading/daily-change.md) documents quote/reference rules and broker data requirements.

Date-stamped audit documents describe the checkout and runtime evidence available on that date. They are historical evidence, not automatic certification of the current release candidate.
