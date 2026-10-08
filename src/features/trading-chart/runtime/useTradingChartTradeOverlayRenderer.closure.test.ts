import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { shouldKeepMissingActiveTradeOverlay } from '../../../services/tradeOverlayHistory';
import type { ActiveTradeSnapshot } from './tradeRuntimeContracts';

// Exercise the production reconciliation branch without creating a chart or a broker connection.
const source = readFileSync(resolve(process.cwd(), 'src/features/trading-chart/runtime/useTradingChartTradeOverlayRenderer.ts'), 'utf8');
const parsed = ts.createSourceFile('renderer.ts', source, ts.ScriptTarget.Latest, true);
let pendingReconciliation = '';
let missingHistorySchedule = '';
const visit = (node: ts.Node) => {
  if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'pendingMissingActiveTradesRef.current.forEach') {
    pendingReconciliation = node.getText(parsed);
  }
  if (ts.isIfStatement(node) && node.expression.getText(parsed) === 'pendingMissingActiveTradesRef.current.size > 0') {
    missingHistorySchedule = node.getText(parsed);
  }
  ts.forEachChild(node, visit);
};
visit(parsed);
if (!pendingReconciliation) throw new Error('Missing production pending-position reconciliation');

const reconcile = (
  evidence: 'none' | 'broker' | 'history' | 'close-request',
  side: 'BUY' | 'SELL' = 'BUY',
  currentPrice = 83000,
) => {
  const now = Date.now();
  const trade: ActiveTradeSnapshot = {
    key: 'trade:14154803', symbol: 'BTCUSD', side, volume: 0.01,
    entryPrice: 83000, entryTime: 1791468000, entryExecutionTime: 1791468010,
    currentPrice, currentTime: 1791468060,
    sl: side === 'BUY' ? 75000 : 90000, tp: side === 'BUY' ? 90000 : 75000,
  };
  const renderActiveSnapshots = new Map();
  const pendingMissingActiveTradesRef = { current: new Map([[trade.key, { trade, missingSince: now - 2000 }]]) };
  const closeSuppressedTradeKeys = new Set(evidence === 'close-request' ? [trade.key] : []);
  const dependencies = {
    now, normalizedChartSymbol: trade.symbol,
    nextActiveSnapshots: new Map(), renderActiveSnapshots, visuallyRetainedActiveTradeKeys: new Set(),
    pendingMissingActiveTradesRef, closeSuppressedTradeKeys,
    realClosedTradeKeys: new Set(evidence === 'history' ? [trade.key] : []),
    shouldKeepMissingActiveTradeOverlay, isPositionMarkedClosed: () => evidence === 'broker',
    getTradeTicket: (key: string) => Number(key.replace('trade:', '')),
  };
  const script = ts.transpileModule(pendingReconciliation, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  new Function(...Object.keys(dependencies), script)(...Object.values(dependencies));
  return { ...dependencies, trade };
};

describe('authoritative chart position closure', () => {
  it.each([
    ['BUY', 83000], ['BUY', 74000], ['BUY', 91000],
    ['SELL', 83000], ['SELL', 74000], ['SELL', 91000],
  ] as const)('retains a missing %s at quote %s without authoritative closure, even across SL/TP', (side, currentPrice) => {
    const h = reconcile('none', side, currentPrice);
    expect(h.renderActiveSnapshots.get(h.trade.key)).toBe(h.trade);
    expect(h.pendingMissingActiveTradesRef.current.get(h.trade.key)?.trade).toBe(h.trade);
    expect(h.visuallyRetainedActiveTradeKeys.has(h.trade.key)).toBe(true);
  });

  it.each(['broker', 'history', 'close-request'] as const)('stops retaining a trade when %s supplies closure evidence', evidence => {
    const h = reconcile(evidence);
    expect(h.renderActiveSnapshots.has(h.trade.key)).toBe(false);
    expect(h.pendingMissingActiveTradesRef.current.has(h.trade.key)).toBe(false);
  });

  it('uses one bounded history recheck and cancels it after the missing trade is resolved', () => {
    expect(missingHistorySchedule).not.toBe('');
    let recheck: () => void = () => undefined;
    const setTimeout = vi.fn((callback: () => void) => { recheck = callback; return 7; });
    const clearTimeout = vi.fn();
    const pendingMissingActiveTradesRef = { current: new Map([['trade:14154803', {}]]) };
    const tradeMissingGraceTimerRef = { current: null as number | null };
    const scheduleHistoryRefresh = vi.fn();
    const renderTradeOverlay = vi.fn();
    const dependencies = {
      pendingMissingActiveTradesRef, tradeMissingGraceTimerRef, scheduleHistoryRefresh,
      renderTradeOverlay, window: { setTimeout, clearTimeout }, TRADE_MISSING_POSITION_GRACE_MS: 30_000,
    };
    const javascript = ts.transpileModule(missingHistorySchedule, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText;
    const schedule = () => new Function(...Object.keys(dependencies), javascript)(...Object.values(dependencies));

    schedule();
    schedule();
    expect(setTimeout).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 30_000);
    expect(scheduleHistoryRefresh).not.toHaveBeenCalled();
    recheck();
    expect(scheduleHistoryRefresh).toHaveBeenCalledOnce();
    expect(renderTradeOverlay).toHaveBeenCalledExactlyOnceWith({ forceActive: true });
    expect(tradeMissingGraceTimerRef.current).toBeNull();
    schedule();
    pendingMissingActiveTradesRef.current.clear();
    schedule();
    expect(clearTimeout).toHaveBeenCalledExactlyOnceWith(7);
    expect(tradeMissingGraceTimerRef.current).toBeNull();
  });
});
