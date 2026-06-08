/**
 * CSV export safety helpers.
 *
 * Two distinct, independent concerns:
 *
 * 1. Formula injection (a.k.a. CSV/spreadsheet injection): a cell whose value
 *    begins with `=`, `+`, `-`, `@`, or a leading tab/CR is interpreted as a
 *    formula by Excel / Google Sheets / LibreOffice when the file is opened.
 *    We neutralize it by prefixing the value with a single quote (`'`) so the
 *    spreadsheet treats it as literal text. (OWASP-recommended mitigation.)
 *
 * 2. RFC 4180 structural quoting: a cell containing a comma, double-quote, CR,
 *    or LF must be wrapped in double quotes with embedded quotes doubled, or it
 *    corrupts column/row boundaries.
 *
 * `sanitizeCsvCell` applies (1) only — use it before handing values to a CSV
 * library (e.g. papaparse) that already performs (2).
 * `escapeCsvCell` applies (1) then (2) — use it when building CSV by hand.
 */

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * Neutralize spreadsheet-formula triggers in a single cell value.
 * Returns a string safe to place in a CSV cell (structural quoting NOT applied).
 */
export const sanitizeCsvCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return FORMULA_TRIGGER.test(str) ? `'${str}` : str;
};

/**
 * Fully escape a single cell for hand-built CSV output: neutralize formula
 * triggers (1) and apply RFC 4180 structural quoting (2).
 */
export const escapeCsvCell = (value: unknown): string => {
  const neutralized = sanitizeCsvCell(value);
  if (/[",\r\n]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
};

/**
 * Recursively neutralize formula triggers in every string field of a row
 * object (shallow values only). Used before passing rows to a CSV library
 * that handles structural quoting itself.
 */
export const sanitizeCsvRow = <T extends Record<string, unknown>>(row: T): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    const v = row[key];
    out[key] = typeof v === 'string' ? sanitizeCsvCell(v) : v;
  }
  return out;
};
