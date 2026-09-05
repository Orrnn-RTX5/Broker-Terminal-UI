import { describe, expect, it } from 'vitest';

import {
  normalizeBrokerTimestampMs,
  normalizeBrokerTimestampSeconds,
  readBrokerTimestampMs,
  readCandleFinality,
} from './brokerStreamSemantics';

describe('broker stream metadata normalization', () => {
  it.each([
    [1_788_176_700, 1_788_176_700_000],
    [1_788_176_700_123, 1_788_176_700_123],
    [1_788_176_700_123_456, 1_788_176_700_123],
    [1_788_176_700_123_456_000, 1_788_176_700_123],
    ['2026-09-04T08:11:40.123Z', 1_788_509_500_123],
  ])('normalizes %s to epoch milliseconds', (raw, expected) => {
    expect(normalizeBrokerTimestampMs(raw)).toBe(expected);
    expect(normalizeBrokerTimestampSeconds(raw)).toBe(Math.floor(expected / 1_000));
  });

  it('reads source time from gateway aliases without using invalid values', () => {
    expect(readBrokerTimestampMs([
      { timestamp: null },
      { event_timestamp: '2026-09-04T08:11:40.123Z' },
    ])).toBe(1_788_509_500_123);
  });

  it.each([
    ['closed', true],
    ['is_closed', true],
    ['isClosed', false],
    ['complete', true],
    ['completed', false],
    ['isComplete', true],
    ['final', false],
  ])('normalizes the %s candle finality alias', (key, expected) => {
    expect(readCandleFinality([{ [key]: expected ? '1' : 0 }])).toBe(expected);
  });

  it('prefers explicit inner candle finality over an outer envelope flag', () => {
    expect(readCandleFinality([{ closed: 'false' }, { final: 1 }])).toBe(false);
  });
});
