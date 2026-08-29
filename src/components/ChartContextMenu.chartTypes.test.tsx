// @vitest-environment jsdom

import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChartContextMenu } from './ChartContextMenu';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderMenu = (currentChartType: 'line' | 'area') => {
  const onChangeChartType = vi.fn();
  const onClose = vi.fn();
  const noop = vi.fn();

  render(
    <ChartContextMenu
      visible
      x={20}
      y={20}
      symbol="XAUUSD"
      currentChartType={currentChartType}
      currentTimeframe="M1"
      onChangeChartType={onChangeChartType}
      onChangeTimeframe={noop}
      onToggleOneClickTrading={noop}
      onToggleGrid={noop}
      onToggleVolumes={noop}
      onToggleAutoScroll={noop}
      onToggleChartShift={noop}
      onOpenProperties={noop}
      onSaveAsPicture={noop}
      onPrintChart={noop}
      onRefresh={noop}
      onZoomIn={noop}
      onZoomOut={noop}
      onDeleteIndicators={noop}
      onOpenNewOrder={noop}
      onOpenDOM={noop}
      onOpenTemplateDialog={noop}
      onClose={onClose}
    />,
  );

  return { onChangeChartType, onClose };
};

describe('ChartContextMenu chart types', () => {
  it('keeps Line and Area separate and places Area immediately after Line', () => {
    const { onChangeChartType, onClose } = renderMenu('line');
    const lineLabel = screen.getByText('Line Chart');
    const areaLabel = screen.getByText('Area Chart');
    const lineItem = lineLabel.parentElement as HTMLDivElement;
    const areaItem = areaLabel.parentElement as HTMLDivElement;

    expect(lineItem.nextElementSibling).toBe(areaItem);
    expect(lineItem).toHaveStyle({ background: 'var(--ctx-item-active-bg, rgba(59, 130, 246, 0.15))' });
    expect(areaItem).toHaveStyle({ background: 'transparent' });

    fireEvent.click(areaItem);
    expect(onChangeChartType).toHaveBeenCalledWith('area');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('marks only Area active when Area is selected and Line still selects Line', () => {
    const { onChangeChartType } = renderMenu('area');
    const lineItem = screen.getByText('Line Chart').parentElement as HTMLDivElement;
    const areaItem = screen.getByText('Area Chart').parentElement as HTMLDivElement;

    expect(lineItem).toHaveStyle({ background: 'transparent' });
    expect(areaItem).toHaveStyle({ background: 'var(--ctx-item-active-bg, rgba(59, 130, 246, 0.15))' });

    fireEvent.click(lineItem);
    expect(onChangeChartType).toHaveBeenCalledWith('line');
  });
});
