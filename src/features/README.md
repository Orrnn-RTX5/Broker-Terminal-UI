# Feature organization

Feature folders own behavior that changes together. Keep presentation, runtime orchestration, pure model helpers, and focused tests beside the feature when practical.

- Put broker/transport infrastructure in `src/services`.
- Put shared application state in `src/store`.
- Put dependency-neutral domain shapes in `src/types`.
- Put cross-feature events and action interfaces in `src/contracts`.
- Keep broadly reusable UI in `src/components/ui`.

During incremental migrations, the former public module may remain as a small re-export facade. New implementation code should import the feature module or neutral contract rather than add logic back to the facade.
