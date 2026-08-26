# Design QA

## Scope

Enterprise typography parity for terminal menus, toolbox tabs, dialogs, floating panels, login and responsive states, plus Advanced View sizing.

## Reference

- Authenticated MetaTrader Web terminal: 14px/400 primary UI, 12px/400 headers and metadata, and 13px/400 dense rows.
- Local RTX5 terminal at `127.0.0.1:5174`.

## Automated checks

- Typography contract: passed (12/12).
- Focused interaction suites: passed; one parallel-run timeout also passed when rerun alone.
- TypeScript: passed.
- Production build: passed.
- CSS selector, cascade, and responsive sizing review: passed.

## Visual comparison

- Blocked: Chrome exposed both authenticated tabs, but they were locked by an older automation session. Fresh comparison tabs and screenshot capture repeatedly timed out and reset the connection.
- No visual pass is claimed. Code-level hierarchy, cascade, and layout audits were completed.

## Severity

- P0: none found in the automated and source audit.
- P1: none found in the automated and source audit.
- P2: none found in the automated and source audit.
- Visual-only unknowns remain because side-by-side capture was unavailable.

final result: blocked
