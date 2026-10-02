# Quality baselines

The files in this directory are ratchets, not target standards.

- `architecture-baseline.json` records allowed type dependency cycles. The architecture guard rejects runtime cycles, unapproved type cycles, and stale type-cycle exceptions. File line counts have no limit and do not block deployment.
- `lint-baseline.json` records the exact current ESLint counts by rule. New debt fails; a reduction also asks for a baseline update so the improvement cannot regress later.

Fix dependency cycles or new lint findings instead of adding exceptions to bypass a failing check. Remove stale type-cycle entries and lower the recorded lint counts when debt is reduced.
