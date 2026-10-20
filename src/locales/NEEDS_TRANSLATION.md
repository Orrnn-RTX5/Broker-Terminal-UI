# NEEDS TRANSLATION — white-label neutral keys (ds-16)

The keys below exist in `en/ui.json` and are ABSENT from the other 18
locale catalogs on purpose. A missing key renders the English value at
runtime via `fallbackLng: 'en'` (src/i18n.ts) — English is never presented
as a translation. Machine source of truth for the grace list:
`translation-todo.json` (read by `catalogs.test.ts`, which still fails on
any OTHER missing key and still enforces placeholder integrity).

Keys needing translation (4):
- `brokerWebsite` (en: "Broker website")
- `Terminal login` (en: "Terminal login")
- `Download desktop installer {{value0}}` (en: "Download desktop installer {{value0}}", placeholder `{{value0}}` must be preserved)
- `Download the latest desktop installer` (en: "Download the latest desktop installer")

Status per locale (missing = renders English via fallback until translated):
ar, de, es, fr, hi, id, it, ja, ko, nl, pl, pt-BR, ru, th, tr, vi, zh-CN, zh-TW: all 4 missing.
en: source, nothing missing.

When a translation lands, add the key with its translated value to that
locale's `ui.json`. Catalog parity requires every NON-allowlisted key in
every locale; allowlisted keys are checked on presence of placeholders when
present.
