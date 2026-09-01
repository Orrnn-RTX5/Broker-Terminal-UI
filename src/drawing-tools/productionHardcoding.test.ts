import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const PRODUCTION_FILES = [
  'contextKey.ts',
  'runtime.ts',
  'WebDrawingToolsRail.tsx',
  'toolCatalog.ts',
] as const;

const DRAWING_INTEGRATION_FILES = [
  'src/services/drawingManager.ts',
  'src/components/TradingChart.tsx',
] as const;

interface LiteralAssignment {
  file: string;
  name: string;
  value: string | number;
}

const readProductionDrawingTools = (): string => PRODUCTION_FILES
  .map((file) => readFileSync(resolve(process.cwd(), 'src/drawing-tools', file), 'utf8'))
  .join('\n');

const readDrawingIntegration = (): Array<{ file: string; source: string }> =>
  DRAWING_INTEGRATION_FILES.map((file) => ({
    file,
    source: readFileSync(resolve(process.cwd(), file), 'utf8'),
  }));

const getAssignedName = (node: ts.Node): string | null => {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return null;
};

const getLiteralValue = (node: ts.Expression | undefined): string | number | null => {
  if (!node) return null;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
    return getLiteralValue(node.expression);
  }
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (
    ts.isPrefixUnaryExpression(node)
    && node.operator === ts.SyntaxKind.MinusToken
    && ts.isNumericLiteral(node.operand)
  ) {
    return -Number(node.operand.text);
  }
  return null;
};

const collectLiteralAssignments = (): LiteralAssignment[] => {
  const assignments: LiteralAssignment[] = [];

  for (const { file, source } of readDrawingIntegration()) {
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const record = (nameNode: ts.Node, valueNode: ts.Expression | undefined) => {
      const name = getAssignedName(nameNode);
      const value = getLiteralValue(valueNode);
      if (name && value !== null) assignments.push({ file, name, value });
    };
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node)
        || ts.isParameter(node)
        || ts.isPropertyDeclaration(node)
        || ts.isPropertyAssignment(node)
      ) {
        record(node.name, node.initializer);
      } else if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        record(node.left, node.right);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return assignments;
};

const normalizeAssignedName = (name: string): string => name.replace(/^_+/, '').toLowerCase();

describe('drawing-tools production data contract', () => {
  it('does not embed account credentials, market selections, or QA recorder data', () => {
    const source = readProductionDrawingTools();

    expect(source).not.toMatch(/\b(?:XAUUSD|EURUSD|BTCUSD|OANDA|M1|M5|M15)\b/);
    expect(source).not.toMatch(/\b\d{6,}\b|\bpassword\b\s*[:=]/i);
    expect(source).not.toMatch(/tradingview\.com|P8prO2VP|record-rtx5|artifacts[\\/]/i);
  });

  it('keeps user data and QA capture data out of the production drawing integration', () => {
    const source = readDrawingIntegration().map(({ source: fileSource }) => fileSource).join('\n');
    const assignments = collectLiteralAssignments();
    const embeddedCredentialOrAccount = assignments.filter(({ name, value }) => {
      const normalizedName = normalizeAssignedName(name);
      if (/^(?:password|passcode|secret|credential)$/.test(normalizedName)) {
        return String(value).trim().length > 0;
      }
      if (!/^(?:account(?:id|scope)?|login(?:id)?)$/.test(normalizedName)) return false;
      if (typeof value === 'number') return Math.abs(value) >= 1_000;
      return value.trim().length > 0;
    });

    expect(embeddedCredentialOrAccount).toEqual([]);
    expect(source).not.toMatch(
      /tradingview\.com|P8prO2VP|(?:^|[\\/])artifacts[\\/]|record-(?:rtx5|tradingview)|\.mp4\b|\bffmpeg\b/im,
    );
  });

  it('does not contain exact market or pointer fixtures in production drawing code', () => {
    const source = readDrawingIntegration().map(({ source: fileSource }) => fileSource).join('\n');
    const assignments = collectLiteralAssignments();
    const marketSymbolFixture = assignments.filter(({ name, value }) => (
      /symbol$/i.test(name)
      && typeof value === 'string'
      && value !== 'UNKNOWN'
      && /^(?:[A-Z0-9]+:)?(?:XAU|XAG|EUR|GBP|USD|JPY|AUD|NZD|CAD|CHF|BTC|ETH)[A-Z0-9._-]{3,}$/.test(value)
    ));
    const nonDefaultTimeframeFixture = assignments.filter(({ name, value }) => (
      /timeframe$/i.test(name)
      && typeof value === 'string'
      // M1 is the terminal's legitimate initial/fallback timeframe, not test data.
      && value !== 'M1'
      && /^(?:M(?:1|5|15|30)|H(?:1|4)|D1|W1|MN1?)$/.test(value)
    ));
    const marketPriceFixture = assignments.filter(({ name, value }) => (
      /^(?:price|open|high|low|close|entryPrice|exitPrice)$/i.test(name)
      && typeof value === 'number'
    ));
    const pointerFixture = assignments.filter(({ name, value }) => (
      /^(?:client|screen|chart)[XY]$/i.test(name)
      && typeof value === 'number'
    ));

    expect(marketSymbolFixture).toEqual([]);
    expect(nonDefaultTimeframeFixture).toEqual([]);
    expect(marketPriceFixture).toEqual([]);
    expect(pointerFixture).toEqual([]);
    expect(source).not.toMatch(
      /\b(?:addPoint|updatePreviewPoint)(?:WithLogical)?\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?/,
    );
  });
});
