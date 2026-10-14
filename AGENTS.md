# Agent guidelines

## White-label / multi-broker rule (PERMANENT, user directive 2026-10-14)

This platform is white-label / main-label technology delivered to many brokers. It is not built for one broker.

- Hardcode NOTHING that is broker-, tenant-, group-, account-, symbol- or business-specific. That means no tenant/broker IDs (e.g. `trivanta-markets`), group names, account logins, manager logins/actors, symbols, commission/swap/margin rates, feed IDs/versions, hostnames, or business thresholds. This applies to code, SQL migrations, scripts, tools, tests' production paths, and docs examples presented as defaults.
- Everything must be configurable per tenant from Admin / Manager (or per-tenant DB config / env), with safe, generic defaults, and must work on a fresh install for any new broker.
- Tools and one-off scripts take tenant, logins, symbols and dates as explicit parameters; they never embed today's values.
- Every fix must work for all brokers, all groups, all current AND future accounts, never just one (no per-account or canary workarounds).
- Reviewers must REJECT any change that introduces such hardcoding. Existing hardcoded values must be moved to configuration when touched.
- Code-version pins (schema/body hashes, migration checksums) are not tenant data and are allowed.

## Engineering rules (all AI agents and contributors)

Read and follow [ENGINEERING_RULES.md](ENGINEERING_RULES.md) for every task: white-label /
multi-broker (hardcode nothing tenant-specific; everything configurable from Admin/Manager),
trading-engine latency and correctness rules, migrations, and the quality bar.
