export const parsePositiveLogin = (value: string | null | undefined): number | null => {
  if (!value) return null;

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
