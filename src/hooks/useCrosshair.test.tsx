// @vitest-environment jsdom

import { act, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import { useCrosshair } from './useCrosshair';

type Listener = () => void;

const createChart = () => {
  const crosshairListeners = new Set<Listener>();
  const visibleRangeListeners = new Set<Listener>();
  const sizeListeners = new Set<Listener>();
  const timeScale = {
    coordinateToLogical: vi.fn((x: number) => x),
    coordinateToTime: vi.fn(() => 1_788_176_700 as Time),
    height: vi.fn(() => 22),
    subscribeVisibleLogicalRangeChange: vi.fn((listener: Listener) => visibleRangeListeners.add(listener)),
    unsubscribeVisibleLogicalRangeChange: vi.fn((listener: Listener) => visibleRangeListeners.delete(listener)),
    subscribeSizeChange: vi.fn((listener: Listener) => sizeListeners.add(listener)),
    unsubscribeSizeChange: vi.fn((listener: Listener) => sizeListeners.delete(listener)),
  };
  const chart = {
    applyOptions: vi.fn(),
    priceScale: vi.fn(() => ({ width: () => 96 })),
    timeScale: vi.fn(() => timeScale),
    subscribeCrosshairMove: vi.fn((listener: Listener) => crosshairListeners.add(listener)),
    unsubscribeCrosshairMove: vi.fn((listener: Listener) => crosshairListeners.delete(listener)),
  };
  return { chart, timeScale, crosshairListeners, visibleRangeListeners, sizeListeners };
};

interface HarnessProps {
  chartRef: { current: IChartApi | null };
  seriesRef: { current: ISeriesApi<any> | null };
  enabled: boolean;
  renderVersion?: number;
  initialCursor?: string;
}

function Harness({ chartRef, seriesRef, enabled, initialCursor }: HarnessProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const refs = useCrosshair({
    chartRef,
    seriesRef,
    containerRef,
    enabled,
    digits: 2,
    timeframe: 'M1',
  });

  return (
    <div ref={containerRef} data-testid="container" style={{ cursor: initialCursor }}>
      <div ref={refs.vertLineRef} data-testid="vertical" />
      <div ref={refs.horizLineRef} data-testid="horizontal" />
      <div ref={refs.centerRef} data-testid="center" />
      <div ref={refs.timeLabelRef} data-testid="time-label" style={{ fontSize: '10px' }} />
      <div ref={refs.priceLabelRef} data-testid="price-label" />
    </div>
  );
}

describe('useCrosshair dirty rendering', () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let requestFrame: ReturnType<typeof vi.fn>;
  let cancelFrame: ReturnType<typeof vi.fn>;
  let offsetWidthReads: number;
  let layoutWidth: number;
  let layoutHeight: number;
  let originalClientWidth: PropertyDescriptor | undefined;
  let originalClientHeight: PropertyDescriptor | undefined;
  let originalOffsetWidth: PropertyDescriptor | undefined;
  let resizeCallbacks: Set<ResizeObserverCallback>;
  let resizeDisconnect: Mock<() => void>;

  const flushFrames = () => {
    const pending = Array.from(frames.entries());
    frames.clear();
    act(() => pending.forEach(([, callback]) => callback(0)));
  };

  beforeEach(() => {
    frames = new Map();
    nextFrameId = 1;
    offsetWidthReads = 0;
    layoutWidth = 500;
    layoutHeight = 300;
    resizeCallbacks = new Set();
    resizeDisconnect = vi.fn<() => void>();
    requestFrame = vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
    cancelFrame = vi.fn((id: number) => frames.delete(id));
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.add(callback);
      }
      observe() {}
      disconnect() {
        resizeDisconnect();
      }
      unobserve() {}
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 510,
      bottom: 320,
      width: 500,
      height: 300,
      toJSON: () => ({}),
    });

    originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => layoutWidth });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => layoutHeight });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => {
        offsetWidthReads += 1;
        return 40;
      },
    });
  });

  afterEach(() => {
    document.documentElement.classList.remove('rtx-skin-untitled-light');
    document.documentElement.style.removeProperty('--rtx-ui-font-size');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    if (originalOffsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
    else Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
  });

  it('renders only dirty frames, coalesces pointer/chart events, and caches label width', () => {
    const first = createChart();
    const chartRef = { current: first.chart as unknown as IChartApi };
    const coordinateToPrice = vi.fn((y: number) => 100 + y / 100);
    const seriesRef = {
      current: { coordinateToPrice } as unknown as ISeriesApi<any>,
    };
    const view = render(<Harness chartRef={chartRef} seriesRef={seriesRef} enabled renderVersion={0} />);

    expect(requestFrame).toHaveBeenCalledTimes(1);
    flushFrames();
    expect(frames.size).toBe(0);
    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(first.crosshairListeners.size).toBe(1);
    expect(first.visibleRangeListeners.size).toBe(1);

    const container = view.getByTestId('container');
    fireEvent.pointerMove(container, { clientX: 25, clientY: 45 });
    fireEvent.pointerMove(container, { clientX: 40, clientY: 60 });
    first.crosshairListeners.forEach((listener) => listener());
    first.visibleRangeListeners.forEach((listener) => listener());
    expect(frames.size).toBe(1);

    flushFrames();
    expect(view.getByTestId('vertical').style.transform).toBe('translate3d(30px,0,0)');
    expect(view.getByTestId('horizontal').style.transform).toBe('translate3d(0,40px,0)');
    expect(view.getByTestId('vertical').style.height).toBe('278px');
    expect(view.getByTestId('horizontal').style.width).toBe('404px');
    expect(view.getByTestId('time-label').style.transform).toBe('translate3d(10px,278px,0)');
    expect(view.getByTestId('price-label').textContent).toBe('100.40');
    expect(offsetWidthReads).toBe(1);
    expect(frames.size).toBe(0);

    first.timeScale.coordinateToTime.mockReturnValue(null);
    coordinateToPrice.mockReturnValue(null);
    first.crosshairListeners.forEach((listener) => listener());
    flushFrames();
    expect(view.getByTestId('time-label').style.opacity).toBe('0');
    expect(view.getByTestId('price-label').style.opacity).toBe('0');
    expect(offsetWidthReads).toBe(1);

    first.timeScale.coordinateToTime.mockReturnValue(1_788_176_701 as Time);
    coordinateToPrice.mockReturnValue(100.4);
    first.crosshairListeners.forEach((listener) => listener());
    flushFrames();
    expect(view.getByTestId('time-label').style.opacity).toBe('1');
    expect(view.getByTestId('price-label').style.opacity).toBe('1');
    expect(view.getByTestId('price-label').textContent).toBe('100.40');

    layoutWidth = 640;
    layoutHeight = 360;
    fireEvent(window, new Event('resize'));
    fireEvent(window, new Event('resize'));
    expect(frames.size).toBe(1);
    flushFrames();
    expect(view.getByTestId('time-label').style.transform).toBe('translate3d(10px,338px,0)');
    expect(view.getByTestId('price-label').style.transform).toBe('translate3d(544px,30px,0)');
    expect(offsetWidthReads).toBe(1);

    fireEvent(window, new Event('scroll'));
    expect(frames.size).toBe(1);
    flushFrames();
    resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver));
    expect(frames.size).toBe(1);
    flushFrames();
    expect(offsetWidthReads).toBe(1);

    view.rerender(<Harness chartRef={chartRef} seriesRef={seriesRef} enabled renderVersion={1} />);
    expect(frames.size).toBe(1);
    flushFrames();
    expect(frames.size).toBe(0);

    fireEvent.pointerMove(container, { clientX: 50, clientY: 70 });
    first.crosshairListeners.forEach((listener) => listener());
    flushFrames();
    expect(offsetWidthReads).toBe(1);

    fireEvent.pointerLeave(container);
    flushFrames();
    expect(view.getByTestId('vertical').style.opacity).toBe('0');
    expect(view.getByTestId('price-label').style.opacity).toBe('0');
    expect(frames.size).toBe(0);
  });

  it('fits labels to the axes in both themes and remeasures font-size changes', () => {
    document.documentElement.classList.add('rtx-skin-untitled-light');
    const fixture = createChart();
    const chartRef = { current: fixture.chart as unknown as IChartApi };
    const seriesRef = {
      current: { coordinateToPrice: vi.fn(() => 101) } as unknown as ISeriesApi<any>,
    };
    const view = render(<Harness chartRef={chartRef} seriesRef={seriesRef} enabled />);
    const timeLabel = view.getByTestId('time-label');
    const priceLabel = view.getByTestId('price-label');
    Object.defineProperty(timeLabel, 'offsetHeight', { configurable: true, value: 26 });
    Object.defineProperty(priceLabel, 'offsetHeight', { configurable: true, value: 26 });
    fireEvent.pointerMove(view.getByTestId('container'), { clientX: 40, clientY: 60 });
    flushFrames();

    expect(timeLabel.style.transform).toBe('translate3d(10px,274px,0)');
    expect(priceLabel.style.transform).toBe('translate3d(404px,27px,0)');
    expect(priceLabel.style.width).toBe('96px');
    expect(offsetWidthReads).toBe(1);

    document.documentElement.classList.remove('rtx-skin-untitled-light');
    fixture.crosshairListeners.forEach((listener) => listener());
    flushFrames();

    expect(timeLabel.style.transform).toBe('translate3d(10px,274px,0)');
    expect(priceLabel.style.transform).toBe('translate3d(404px,27px,0)');
    expect(priceLabel.style.width).toBe('96px');
    expect(offsetWidthReads).toBe(2);

    document.documentElement.style.setProperty('--rtx-ui-font-size', '15px');
    Object.defineProperty(timeLabel, 'offsetHeight', { configurable: true, value: 28 });
    Object.defineProperty(priceLabel, 'offsetHeight', { configurable: true, value: 28 });
    fixture.crosshairListeners.forEach((listener) => listener());
    flushFrames();

    expect(timeLabel.style.transform).toBe('translate3d(10px,272px,0)');
    expect(priceLabel.style.transform).toBe('translate3d(404px,26px,0)');
    expect(offsetWidthReads).toBe(3);
  });

  it('keeps Cross guides in the plot and hides them over the axes', () => {
    const fixture = createChart();
    const view = render(<Harness
      chartRef={{ current: fixture.chart as unknown as IChartApi }}
      seriesRef={{ current: { coordinateToPrice: vi.fn(() => 101) } as unknown as ISeriesApi<any> }}
      enabled
    />);
    const container = view.getByTestId('container');
    flushFrames();

    fireEvent.pointerMove(container, { clientX: 50, clientY: 60 });
    flushFrames();
    expect(view.getByTestId('vertical').style.opacity).toBe('1');
    expect(view.getByTestId('horizontal').style.opacity).toBe('1');

    fireEvent.pointerMove(container, { clientX: 430, clientY: 60 });
    flushFrames();
    expect(view.getByTestId('vertical').style.opacity).toBe('0');
    expect(view.getByTestId('price-label').style.opacity).toBe('0');

    fireEvent.pointerMove(container, { clientX: 50, clientY: 300 });
    flushFrames();
    expect(view.getByTestId('horizontal').style.opacity).toBe('0');
    expect(view.getByTestId('time-label').style.opacity).toBe('0');
  });

  it('rebinds replaced charts and stops all scheduling while disabled or disposed', () => {
    const first = createChart();
    const second = createChart();
    const replacementScale = createChart();
    const chartRef = { current: first.chart as unknown as IChartApi };
    const seriesRef = {
      current: { coordinateToPrice: vi.fn(() => 101) } as unknown as ISeriesApi<any>,
    };
    const view = render(
      <Harness chartRef={chartRef} seriesRef={seriesRef} enabled renderVersion={0} initialCursor="grab" />,
    );
    flushFrames();
    const container = view.getByTestId('container');
    expect(container.style.cursor).toBe('grab');

    first.chart.timeScale.mockReturnValue(replacementScale.timeScale);
    view.rerender(
      <Harness chartRef={chartRef} seriesRef={seriesRef} enabled renderVersion={1} initialCursor="grab" />,
    );
    flushFrames();
    expect(first.crosshairListeners.size).toBe(1);
    expect(first.visibleRangeListeners.size).toBe(0);
    expect(first.sizeListeners.size).toBe(0);
    expect(replacementScale.visibleRangeListeners.size).toBe(1);
    expect(replacementScale.sizeListeners.size).toBe(1);
    expect(first.chart.unsubscribeCrosshairMove).toHaveBeenCalledTimes(1);
    expect(first.timeScale.unsubscribeVisibleLogicalRangeChange).toHaveBeenCalledTimes(1);
    expect(first.timeScale.unsubscribeSizeChange).toHaveBeenCalledTimes(1);

    chartRef.current = second.chart as unknown as IChartApi;
    view.rerender(
      <Harness chartRef={chartRef} seriesRef={seriesRef} enabled renderVersion={2} initialCursor="grab" />,
    );
    expect(frames.size).toBe(1);
    flushFrames();
    expect(first.crosshairListeners.size).toBe(0);
    expect(replacementScale.visibleRangeListeners.size).toBe(0);
    expect(replacementScale.sizeListeners.size).toBe(0);
    expect(second.crosshairListeners.size).toBe(1);
    expect(first.chart.unsubscribeCrosshairMove).toHaveBeenCalledTimes(2);
    expect(replacementScale.timeScale.unsubscribeVisibleLogicalRangeChange).toHaveBeenCalledTimes(1);
    expect(replacementScale.timeScale.unsubscribeSizeChange).toHaveBeenCalledTimes(1);
    expect(second.chart.applyOptions).toHaveBeenCalledWith({
      crosshair: {
        mode: 2,
        vertLine: { visible: false, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
    });
    expect(container.style.cursor).toBe('grab');

    view.rerender(
      <Harness chartRef={chartRef} seriesRef={seriesRef} enabled={false} renderVersion={3} initialCursor="grab" />,
    );
    expect(frames.size).toBe(0);
    expect(second.crosshairListeners.size).toBe(0);
    expect(container.style.cursor).toBe('grab');
    fireEvent.pointerMove(container, { clientX: 50, clientY: 70 });
    fireEvent(window, new Event('scroll'));
    expect(frames.size).toBe(0);

    view.rerender(
      <Harness chartRef={chartRef} seriesRef={seriesRef} enabled renderVersion={4} initialCursor="grab" />,
    );
    flushFrames();
    expect(container.style.cursor).toBe('grab');
    fireEvent.pointerMove(container, { clientX: 50, clientY: 70 });
    expect(frames.size).toBe(1);
    view.unmount();
    expect(cancelFrame).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(second.crosshairListeners.size).toBe(0);
    expect(container.style.cursor).toBe('grab');
    expect(resizeDisconnect).toHaveBeenCalled();
  });

  it('does not take or blank cursor ownership while inactive', () => {
    const fixture = createChart();
    const chartRef = { current: fixture.chart as unknown as IChartApi };
    const seriesRef = {
      current: { coordinateToPrice: vi.fn(() => 101) } as unknown as ISeriesApi<any>,
    };
    const view = render(
      <Harness chartRef={chartRef} seriesRef={seriesRef} enabled={false} initialCursor="crosshair" />,
    );
    const container = view.getByTestId('container');

    expect(container.style.cursor).toBe('crosshair');
    expect(fixture.chart.applyOptions).toHaveBeenCalledWith({
      crosshair: {
        mode: 0,
        vertLine: { visible: false, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
    });
    expect(requestFrame).not.toHaveBeenCalled();
    fireEvent.pointerMove(container, { clientX: 50, clientY: 70 });
    fireEvent(window, new Event('scroll'));
    expect(requestFrame).not.toHaveBeenCalled();
    view.unmount();
    expect(container.style.cursor).toBe('crosshair');
  });
});
