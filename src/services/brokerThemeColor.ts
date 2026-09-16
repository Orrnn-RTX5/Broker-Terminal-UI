const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Restrict broker-provided UI colours before they reach CSS or storage. */
export const normalizeBrokerThemeColor = (value: unknown): string => {
  const color = String(value || '').trim();
  return HEX_COLOR.test(color) ? color : '';
};
