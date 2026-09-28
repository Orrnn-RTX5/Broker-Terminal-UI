# Quality baselines

The files in this directory are ratchets, not target standards.

- `architecture-baseline.json` keeps new production modules at 1,000 lines, new tests and styles at 1,200 lines, forbids runtime/type dependency cycles, and applies a 5,000-line hard ceiling. Existing exceptions are pinned to their exact current size. A reduction deliberately fails until the recorded value is lowered, preventing later regrowth.
- `lint-baseline.json` records the exact current ESLint counts by rule. New debt fails; a reduction also asks for a baseline update so the improvement cannot regress later.

Do not increase a baseline to make a failing check pass. Refactor or fix the new finding. When an existing exception is reduced, lower its recorded value or remove the entry entirely.
