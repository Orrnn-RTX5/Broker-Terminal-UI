# NEEDS TRANSLATION — white-label neutral keys (ds-16)

The keys below exist in `en/ui.json` with English values and are copied
verbatim into the other 18 locale catalogs as **untranslated placeholders**.
That keeps `catalogs.test.ts` parity green (every locale must contain every
key) while the vendor strings they replace stay out of the build. They are
NOT genuinely translated — English text renders for these strings in
non-English locales until a translator provides values.

Keys needing translation (4):
- `brokerWebsite` (en: "Broker website")
- `Terminal login` (en: "Terminal login")
- `Download desktop installer {{value0}}` (en: "Download desktop installer {{value0}}", placeholder `{{value0}}` must be preserved)
- `Download the latest desktop installer` (en: "Download the latest desktop installer")

Status per locale (pending = English placeholder value shipped):
ar, de, es, fr, hi, id, it, ja, ko, nl, pl, pt-BR, ru, th, tr, vi, zh-CN, zh-TW: all 4 PENDING.
en: source, nothing pending.

When a translation lands, replace the English value in that locale's
`ui.json` and remove the locale from the pending list above. Do not delete
the keys: catalog parity requires every key in every locale.
