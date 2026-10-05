// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useMemo } from 'react';
import { cleanup, renderHook } from '@testing-library/react';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeSymbolName } from './utils/symbolEligibility';

// Execute App's actual memo declarations with React, rather than duplicating
// their algorithm in a test-only helper or mounting unrelated terminal services.
const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations: string[] = [];
const visit = (node: ts.Node) => {
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => (
    ts.isIdentifier(declaration.name)
      && ['chartPickerInstrumentIndex', 'chartPickerInstruments'].includes(declaration.name.text)
  ))) declarations.push(node.getText(tree));
  ts.forEachChild(node, visit);
};
visit(tree);
const compiled = ts.transpileModule(`${declarations.join('\n')}\nreturn chartPickerInstruments;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const runAppPickerMemos = new Function(
  'useMemo', 'normalizeSymbolName', 'allSymbols', 'chartEligibleSymbolNames', compiled,
) as (memo: typeof useMemo, normalize: typeof normalizeSymbolName, catalog: unknown[], eligible: string[]) => unknown[];

const useAppPicker = ({ catalog, eligible }: { catalog: unknown[]; eligible: string[] }) => (
  runAppPickerMemos(useMemo, normalizeSymbolName, catalog, eligible)
);

afterEach(cleanup);

describe('App chart picker catalogue lookup', () => {
  it('exercises the production memo output passed to the chart picker', () => {
    expect(declarations.some(text => text.startsWith('const chartPickerInstruments = useMemo'))).toBe(true);
    expect(source).toContain('instruments={chartPickerInstruments}');
  });

  it('retains first normalized matches, catalogue objects, eligible order and duplicates', () => {
    const first = { symbol: ' btcusd ', label: 'first' };
    const duplicate = { symbol: 'BTCUSD', label: 'second' };
    const named = { symbol: null, name: ' eurusd ', label: 'named' };
    const empty = { symbol: '', name: 'SHOULD_NOT_MATCH' };
    const catalog = [first, duplicate, named, empty, { id: 'ID_ONLY' }, ' xauusd '];
    const eligible = ['EURUSD', 'BTCUSD', 'XAUUSD', 'BTCUSD', 'MISSING', 'SHOULD_NOT_MATCH', 'ID_ONLY', ' btcusd '];
    const { result } = renderHook(useAppPicker, { initialProps: { catalog, eligible } });
    expect(result.current).toEqual([
      named, first, ' xauusd ', first, { symbol: 'MISSING' },
      { symbol: 'SHOULD_NOT_MATCH' }, { symbol: 'ID_ONLY' }, { symbol: ' btcusd ' },
    ]);
    expect(result.current[0]).toBe(named);
    expect(result.current[1]).toBe(first);
    expect(result.current[3]).toBe(first);
  });

  it('preserves nullish first-match fallback and primitive matches', () => {
    const catalog = [undefined, null, { symbol: '' }, 0, false];
    const { result } = renderHook(useAppPicker, {
      initialProps: { catalog, eligible: ['', '0', 'FALSE'] },
    });
    expect(result.current).toEqual([{ symbol: '' }, 0, false]);
  });

  it('reads a 561-symbol catalogue only once instead of repeated prefix scans', () => {
    let reads = 0;
    const eligible = Array.from({ length: 561 }, (_, index) => `SYMBOL${index}`);
    const catalog = eligible.map(symbol => ({ get symbol() { reads += 1; return symbol; } }));
    const { result } = renderHook(useAppPicker, { initialProps: { catalog, eligible } });
    expect(result.current.every((instrument, index) => instrument === catalog[index])).toBe(true);
    expect(reads).toBeLessThanOrEqual(catalog.length);
  });

  it('reuses catalogue indexing when only eligible ordering changes', () => {
    let reads = 0;
    const catalog = ['BTCUSD', 'EURUSD', 'XAUUSD'].map(symbol => ({
      get symbol() { reads += 1; return symbol; },
    }));
    const initialProps = { catalog, eligible: ['BTCUSD', 'EURUSD'] };
    const { result, rerender } = renderHook(useAppPicker, { initialProps });
    const initialOutput = result.current;
    rerender(initialProps);
    expect(result.current).toBe(initialOutput);
    reads = 0;
    rerender({ catalog, eligible: ['XAUUSD', 'BTCUSD', 'MISSING'] });
    expect(result.current).toEqual([catalog[2], catalog[0], { symbol: 'MISSING' }]);
    expect(reads).toBe(0);
  });

  it('rebuilds after catalogue replacement without retaining a removed instrument', () => {
    const oldInstrument = { symbol: 'BTCUSD', label: 'old' };
    const replacement = { symbol: 'BTCUSD', label: 'replacement' };
    const eligible = ['BTCUSD', 'EURUSD'];
    const { result, rerender } = renderHook(useAppPicker, {
      initialProps: { catalog: [oldInstrument], eligible },
    });
    rerender({ catalog: [replacement], eligible });
    expect(result.current[0]).toBe(replacement);
    rerender({ catalog: [], eligible });
    expect(result.current).toEqual([{ symbol: 'BTCUSD' }, { symbol: 'EURUSD' }]);
  });
});
