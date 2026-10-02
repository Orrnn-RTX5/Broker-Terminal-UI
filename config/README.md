# Quality configuration

- `architecture-baseline.json` records allowed type dependency cycles. The architecture guard rejects runtime cycles, unapproved type cycles, and stale type-cycle exceptions. File line counts have no limit and do not block deployment.
- ESLint is available through `npm run lint` for local code review. CI does not compare lint counts or block deployment when those counts increase or decrease.

Fix dependency cycles instead of adding exceptions to bypass a failing check, and remove stale type-cycle entries.
