import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const toolbarSource = readFileSync(
  resolve(process.cwd(), 'src/components/layout/TopToolbar.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');

const chartTypeGroup = toolbarSource.slice(
  toolbarSource.indexOf('{/* Group 3: Chart Types */}'),
  toolbarSource.indexOf('{/* Group 4: Zoom */}'),
);

describe('TopToolbar chart type controls', () => {
  it('keeps Line distinct and places Area immediately after it', () => {
    const lineIndex = chartTypeGroup.indexOf('title="Line Chart"');
    const areaIndex = chartTypeGroup.indexOf('title="Area Chart"');

    expect(lineIndex).toBeGreaterThanOrEqual(0);
    expect(areaIndex).toBeGreaterThan(lineIndex);
    expect(chartTypeGroup.slice(lineIndex, areaIndex)).toContain("active={toolbarState.chartType === 'line'}");
    expect(chartTypeGroup.slice(lineIndex, areaIndex)).toContain("onChartTypeChange('line')");
    expect(chartTypeGroup.slice(areaIndex)).toContain("active={toolbarState.chartType === 'area'}");
    expect(chartTypeGroup.slice(areaIndex)).toContain("onChartTypeChange('area')");
    expect(chartTypeGroup).not.toContain("chartType === 'line' || toolbarState.chartType === 'area'");
  });
});
