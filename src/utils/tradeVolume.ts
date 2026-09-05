export interface TradeVolumeMetadata {
  minVolume?: number;
  maxVolume?: number;
  volumeStep?: number;
}

export interface TradeVolumeConstraints {
  min: number;
  max?: number;
  step: number;
  precision: number;
}

const DEFAULT_VOLUME_STEP = 0.01;
const MAX_VOLUME_PRECISION = 8;
const DECIMAL_DRAFT_PATTERN = /^\d*(?:\.\d*)?$/;

const readPositiveFinite = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const getDecimalPlaces = (value: number): number => {
  const normalized = value.toString().toLowerCase();
  const [coefficient, exponentText] = normalized.split('e');
  const coefficientDecimals = coefficient.includes('.') ? coefficient.split('.')[1].length : 0;
  const exponent = exponentText ? Number(exponentText) : 0;
  return Math.min(MAX_VOLUME_PRECISION, Math.max(0, coefficientDecimals - exponent));
};

export const resolveTradeVolumeConstraints = (
  metadata: TradeVolumeMetadata = {},
): TradeVolumeConstraints => {
  // FIX: Broker volume step/minimum are instrument properties. Use the broker
  // values when present, with 0.01 only as a compatibility fallback.
  const step = readPositiveFinite(metadata.volumeStep) ?? DEFAULT_VOLUME_STEP;
  const min = readPositiveFinite(metadata.minVolume) ?? step;
  const rawMax = readPositiveFinite(metadata.maxVolume);
  const max = rawMax !== undefined && rawMax >= min ? rawMax : undefined;
  const precision = Math.max(getDecimalPlaces(min), getDecimalPlaces(step));

  return { min, max, step, precision };
};

export const parseTradeVolumeDraft = (draft: string): number | null => {
  if (!draft.trim()) return null;
  const parsed = Number(draft);
  return Number.isFinite(parsed) ? parsed : null;
};

export const isTradeVolumeDraftSyntax = (draft: string): boolean => (
  draft === '' || DECIMAL_DRAFT_PATTERN.test(draft)
);

export const normalizeTradeVolume = (
  value: number,
  constraints: TradeVolumeConstraints,
): number => {
  const scale = 10 ** constraints.precision;
  const minUnits = Math.round(constraints.min * scale);
  const stepUnits = Math.max(1, Math.round(constraints.step * scale));
  const maxUnits = constraints.max === undefined
    ? undefined
    : minUnits + Math.floor((Math.round(constraints.max * scale) - minUnits) / stepUnits) * stepUnits;
  const requestedUnits = Number.isFinite(value) ? Math.round(value * scale) : minUnits;
  const boundedUnits = Math.max(minUnits, maxUnits === undefined
    ? requestedUnits
    : Math.min(maxUnits, requestedUnits));
  const stepCount = Math.round((boundedUnits - minUnits) / stepUnits);
  const normalizedUnits = minUnits + stepCount * stepUnits;
  const cappedUnits = maxUnits === undefined ? normalizedUnits : Math.min(maxUnits, normalizedUnits);

  return Number((cappedUnits / scale).toFixed(constraints.precision));
};

export const isTradeVolumeValid = (
  value: number,
  constraints: TradeVolumeConstraints,
): boolean => {
  if (!Number.isFinite(value) || value < constraints.min) return false;
  if (constraints.max !== undefined && value > constraints.max) return false;

  const tolerance = 1 / (10 ** (constraints.precision + 2));
  return Math.abs(normalizeTradeVolume(value, constraints) - value) < tolerance;
};

export const formatTradeVolume = (
  value: number,
  constraints: TradeVolumeConstraints,
): string => normalizeTradeVolume(value, constraints).toFixed(constraints.precision);
