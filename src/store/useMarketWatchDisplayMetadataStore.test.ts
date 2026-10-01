import { useWebSocketStore } from './useWebSocketStore';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { commitBrokerAccountSessionScope } from '../services/brokerSession';
import {
  getMarketWatchDisplayMetadata,
  publishMarketWatchDisplayMetadata,
  resolveMarketWatchDisplayMetadata,
  resetMarketWatchDisplayMetadataForTests,
} from './useMarketWatchDisplayMetadataStore';

describe('Market Watch display metadata store', () => {
  beforeEach(() => {
    useWebSocketStore.setState({ fixConnectionState: 'connected', isStale: false });
    commitBrokerAccountSessionScope({
      authenticated: true,
      accountId: '1001',
      brokerId: 'broker-a',
      serverUrl: 'https://broker-a.test',
    });
    resetMarketWatchDisplayMetadataForTests();
  });

  it('retains values and their timestamps through disconnect until a fresh reconnect quote', () => {
    const at = Date.parse('2026-03-07T22:00:00Z');
    publishMarketWatchDisplayMetadata('EURUSD.r', { timestamp: at, sourceTimestamp: at,
      dailyChangeInput: { mode: 'bid', bid: 105, previousClose: 100, sessionId: 'session-a' } });
    useWebSocketStore.getState().setConnectionState('disconnected', 'fix_socket');
    expect(getMarketWatchDisplayMetadata('EURUSD.r')?.daily).toMatchObject({ percent: 5, valuesAsOf: at, status: 'disconnected' });
    useWebSocketStore.getState().setConnectionState('connected', 'fix_socket');
    expect(getMarketWatchDisplayMetadata('EURUSD.r')?.daily?.status).toBe('stale');
    publishMarketWatchDisplayMetadata('EURUSD.r', { timestamp: at + 1, sourceTimestamp: at + 1, dailyChangeInput: { bid: 110 } });
    expect(getMarketWatchDisplayMetadata('EURUSD.r')?.daily).toMatchObject({ percent: 10, status: 'live', valuesAsOf: at + 1 });
  });

  afterEach(() => {
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
    resetMarketWatchDisplayMetadataForTests();
  });

  it('orders exact-symbol display metadata by broker event time', () => {
    expect(publishMarketWatchDisplayMetadata('future.last', {
      last: 120,
      dailyChange: 20,
      timestamp: 2_000,
      sourceTimestamp: 2_000,
    })).toBe(true);
    expect(publishMarketWatchDisplayMetadata('FUTURE.LAST', {
      last: 110,
      dailyChange: 10,
      timestamp: 1_000,
      sourceTimestamp: 1_000,
    })).toBe(false);

    expect(getMarketWatchDisplayMetadata('future.last')).toMatchObject({
      symbol: 'FUTURE.LAST',
      last: 120,
      dailyChange: 20,
      sourceTimestamp: 2_000,
    });
  });

  it('retains omitted finite display fields only within the same UTC quote day', () => {
    const dayOne = Date.UTC(2026, 8, 28, 20, 0);
    const sameDay = dayOne + 60_000;
    const dayTwo = Date.UTC(2026, 8, 29, 1, 0);

    publishMarketWatchDisplayMetadata('FUTURE.LAST', {
      last: 120,
      dailyChange: 20,
      timestamp: dayOne,
      sourceTimestamp: dayOne,
    });
    publishMarketWatchDisplayMetadata('FUTURE.LAST', {
      last: 121,
      timestamp: sameDay,
      sourceTimestamp: sameDay,
    });
    expect(getMarketWatchDisplayMetadata('FUTURE.LAST')).toMatchObject({
      last: 121,
      dailyChange: 20,
      sourceTimestamp: sameDay,
    });

    publishMarketWatchDisplayMetadata('FUTURE.LAST', {
      last: 125,
      timestamp: dayTwo,
      sourceTimestamp: dayTwo,
    });
    expect(getMarketWatchDisplayMetadata('FUTURE.LAST')).toEqual({
      symbol: 'FUTURE.LAST',
      last: 125,
      lastSourceTimestamp: dayTwo,
      dailyChange: undefined,
      dailyChangeSourceTimestamp: undefined,
      timestamp: dayTwo,
      sourceTimestamp: dayTwo,
    });

    publishMarketWatchDisplayMetadata('FUTURE.DAILY', {
      last: 120,
      dailyChange: 20,
      timestamp: dayOne,
      sourceTimestamp: dayOne,
    });
    publishMarketWatchDisplayMetadata('FUTURE.DAILY', {
      dailyChange: 1,
      timestamp: dayTwo,
      sourceTimestamp: dayTwo,
    });
    expect(getMarketWatchDisplayMetadata('FUTURE.DAILY')).toEqual({
      symbol: 'FUTURE.DAILY',
      last: undefined,
      lastSourceTimestamp: undefined,
      dailyChange: 1,
      dailyChangeSourceTimestamp: dayTwo,
      timestamp: dayTwo,
      sourceTimestamp: dayTwo,
    });
  });

  it('backfills a missing field from an older event only on the same UTC quote day', () => {
    const dayOne = Date.UTC(2026, 8, 28, 20, 0);
    const newerSameDay = dayOne + 60_000;
    const dayTwo = Date.UTC(2026, 8, 29, 1, 0);

    publishMarketWatchDisplayMetadata('REVERSE.SAME', {
      last: 121,
      timestamp: newerSameDay,
      sourceTimestamp: newerSameDay,
    });
    expect(publishMarketWatchDisplayMetadata('REVERSE.SAME', {
      last: 120,
      dailyChange: 20,
      timestamp: dayOne,
      sourceTimestamp: dayOne,
    })).toBe(true);
    expect(getMarketWatchDisplayMetadata('REVERSE.SAME')).toEqual({
      symbol: 'REVERSE.SAME',
      last: 121,
      lastSourceTimestamp: newerSameDay,
      dailyChange: 20,
      dailyChangeSourceTimestamp: dayOne,
      timestamp: newerSameDay,
      sourceTimestamp: newerSameDay,
    });
    const intermediateSameDay = dayOne + 30_000;
    expect(publishMarketWatchDisplayMetadata('REVERSE.SAME', {
      dailyChange: 21,
      timestamp: intermediateSameDay,
      sourceTimestamp: intermediateSameDay,
    })).toBe(true);
    expect(getMarketWatchDisplayMetadata('REVERSE.SAME')).toEqual({
      symbol: 'REVERSE.SAME',
      last: 121,
      lastSourceTimestamp: newerSameDay,
      dailyChange: 21,
      dailyChangeSourceTimestamp: intermediateSameDay,
      timestamp: newerSameDay,
      sourceTimestamp: newerSameDay,
    });

    publishMarketWatchDisplayMetadata('REVERSE.CROSS', {
      last: 125,
      timestamp: dayTwo,
      sourceTimestamp: dayTwo,
    });
    expect(publishMarketWatchDisplayMetadata('REVERSE.CROSS', {
      last: 120,
      dailyChange: 20,
      timestamp: dayOne,
      sourceTimestamp: dayOne,
    })).toBe(false);
    expect(getMarketWatchDisplayMetadata('REVERSE.CROSS')).toEqual({
      symbol: 'REVERSE.CROSS',
      last: 125,
      lastSourceTimestamp: dayTwo,
      dailyChange: undefined,
      dailyChangeSourceTimestamp: undefined,
      timestamp: dayTwo,
      sourceTimestamp: dayTwo,
    });
  });

  it('clears metadata at a committed broker/account boundary', () => {
    publishMarketWatchDisplayMetadata('FUTURE.LAST', {
      last: 120,
      dailyChange: 20,
      timestamp: 2_000,
      sourceTimestamp: 2_000,
    });

    commitBrokerAccountSessionScope({
      authenticated: true,
      accountId: '2002',
      brokerId: 'broker-b',
      serverUrl: 'https://broker-b.test',
    });

    expect(getMarketWatchDisplayMetadata('FUTURE.LAST')).toBeUndefined();
  });

  it('resolves only Last and Daily Change without manufacturing quote sides', () => {
    const metadata = {
      symbol: 'FUTURE.LAST',
      last: 120,
      dailyChange: 20,
      timestamp: 2_000,
      sourceTimestamp: 2_000,
    };
    expect(resolveMarketWatchDisplayMetadata({
      timestamp: 1_000,
      sourceTimestamp: 1_000,
      last: 119,
      dailyChange: 19,
    }, metadata)).toMatchObject({
      last: 120,
      lastSourceTimestamp: 2_000,
      dailyChange: 20,
      dailyChangeSourceTimestamp: 2_000,
      timestamp: 2_000,
    });
  });

  it('lets a newer normal quote win and never carries display metadata into the next quote day', () => {
    const dayOne = Date.UTC(2026, 8, 28, 20, 0);
    const dayTwo = Date.UTC(2026, 8, 29, 1, 0);
    const metadata = {
      symbol: 'FUTURE.LAST',
      last: 120,
      dailyChange: 20,
      timestamp: dayOne,
      sourceTimestamp: dayOne,
    };

    expect(resolveMarketWatchDisplayMetadata({
      timestamp: dayTwo,
      sourceTimestamp: dayTwo,
      last: 125,
      dailyChange: 4,
    }, metadata)).toMatchObject({
      last: 125,
      dailyChange: 4,
      timestamp: dayTwo,
    });
    expect(resolveMarketWatchDisplayMetadata({
      timestamp: dayTwo,
      sourceTimestamp: dayTwo,
    }, metadata)).toMatchObject({
      last: undefined,
      dailyChange: undefined,
      timestamp: undefined,
    });
  });

  it('resolves Last and Daily Change by independent field authority', () => {
    const day = Date.UTC(2026, 8, 28, 20, 0);
    const metadataDailyTime = day + 30_000;
    const appDailyTime = day + 45_000;
    const metadataLastTime = day + 60_000;

    publishMarketWatchDisplayMetadata('FIELD.AUTHORITY', {
      last: 121,
      timestamp: metadataLastTime,
      sourceTimestamp: metadataLastTime,
    });
    publishMarketWatchDisplayMetadata('FIELD.AUTHORITY', {
      dailyChange: 15,
      timestamp: metadataDailyTime,
      sourceTimestamp: metadataDailyTime,
    });

    expect(resolveMarketWatchDisplayMetadata({
      last: 119,
      dailyChange: 17,
      dailyChangeSourceTimestamp: appDailyTime,
      timestamp: appDailyTime,
      sourceTimestamp: appDailyTime,
    }, getMarketWatchDisplayMetadata('FIELD.AUTHORITY'))).toMatchObject({
      last: 121,
      lastSourceTimestamp: metadataLastTime,
      dailyChange: 17,
      dailyChangeSourceTimestamp: appDailyTime,
      timestamp: metadataLastTime,
    });
  });

  it('fills newer sparse metadata from an App tick only on the same UTC quote day', () => {
    const dayOne = Date.UTC(2026, 8, 28, 20, 0);
    const sameDay = dayOne + 60_000;
    const dayTwo = Date.UTC(2026, 8, 29, 1, 0);
    const tick = {
      timestamp: dayOne,
      sourceTimestamp: dayOne,
      last: 119,
      dailyChange: 19,
    };

    expect(resolveMarketWatchDisplayMetadata(tick, {
      symbol: 'FUTURE.LAST',
      last: 120,
      timestamp: sameDay,
      sourceTimestamp: sameDay,
    })).toMatchObject({ last: 120, dailyChange: 19, timestamp: sameDay });

    expect(resolveMarketWatchDisplayMetadata(tick, {
      symbol: 'FUTURE.LAST',
      dailyChange: 1,
      timestamp: dayTwo,
      sourceTimestamp: dayTwo,
    })).toMatchObject({ last: undefined, dailyChange: 1, timestamp: dayTwo });
    expect(resolveMarketWatchDisplayMetadata(tick, {
      symbol: 'FUTURE.LAST',
      last: 125,
      timestamp: dayTwo,
      sourceTimestamp: dayTwo,
    })).toMatchObject({ last: 125, dailyChange: undefined, timestamp: dayTwo });
  });

  it('prefers finite normal-quote fields at equal broker time and only fills omissions', () => {
    const timestamp = Date.UTC(2026, 8, 28, 20, 0);
    const metadata = {
      symbol: 'FUTURE.LAST',
      last: 120,
      dailyChange: 20,
      timestamp,
      sourceTimestamp: timestamp,
    };

    expect(resolveMarketWatchDisplayMetadata({
      timestamp,
      sourceTimestamp: timestamp,
      last: 121,
      dailyChange: 21,
    }, metadata)).toMatchObject({ last: 121, dailyChange: 21, timestamp });
    expect(resolveMarketWatchDisplayMetadata({
      timestamp,
      sourceTimestamp: timestamp,
    }, metadata)).toMatchObject({ last: 120, dailyChange: 20, timestamp });
  });

  it('refuses metadata without an identified anonymous broker scope', () => {
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });

    expect(publishMarketWatchDisplayMetadata('FUTURE.LAST', {
      last: 120,
      dailyChange: 20,
      timestamp: 2_000,
      sourceTimestamp: 2_000,
    })).toBe(false);
    expect(getMarketWatchDisplayMetadata('FUTURE.LAST')).toBeUndefined();
  });
});
