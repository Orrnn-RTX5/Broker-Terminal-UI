import type { IChartApi } from 'lightweight-charts';

export type ChartWheelInput = Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>;

export interface ChartWheelNormalizationOptions {
  windowsChromium?: boolean;
  devicePixelRatio?: number;
}

export interface ChartWheelSmoothingOptions {
  chart: IChartApi;
  canInteract: () => boolean;
  onActivity: () => void;
  onFrame: () => void;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (frameId: number) => void;
}

export interface ChartWheelSmoothing {
  handleWheel: (event: ChartWheelInput, anchorX: number) => boolean;
  cancel: () => void;
  dispose: () => void;
}

const browserWheelNormalization = (): ChartWheelNormalizationOptions => {
  if (typeof navigator === 'undefined') return {};
  const client = navigator as Navigator & {
    userAgentData?: { platform?: string; brands?: Array<{ brand: string }> };
  };
  const windows = client.userAgentData?.platform
    ? client.userAgentData.platform === 'Windows'
    : /Windows|Win32|Win64/.test(client.userAgent);
  const chromium = client.userAgentData?.brands
    ? client.userAgentData.brands.some(({ brand }) => brand.includes('Chromium'))
    : /Chrome|Chromium|Edg\//.test(client.userAgent);
  return {
    windowsChromium: windows && chromium,
    devicePixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio,
  };
};

/** Keep the library's wheel sensitivity while retaining fractional trackpad input. */
export const normalizeChartWheelInput = (
  event: ChartWheelInput,
  options: ChartWheelNormalizationOptions = browserWheelNormalization(),
): { zoom: number; panPixels: number } | null => {
  if (!Number.isFinite(event.deltaX) || !Number.isFinite(event.deltaY)) return null;
  const ratio = Number.isFinite(options.devicePixelRatio) && options.devicePixelRatio! > 0
    ? options.devicePixelRatio!
    : 1;
  const adjustment = event.deltaMode === 1
    ? 32
    : event.deltaMode === 2
      ? 120
      : event.deltaMode === 0
        ? options.windowsChromium ? 1 / ratio : 1
        : NaN;
  const zoom = Math.max(-1, Math.min(1, -event.deltaY * adjustment / 100)) || 0;
  const panPixels = event.deltaX * adjustment * 0.8;
  return Number.isFinite(zoom) && Number.isFinite(panPixels) && (zoom !== 0 || panPixels !== 0)
    ? { zoom, panPixels } : null;
};

/** Animate only the shared time scale; price-axis transforms remain chart-owned. */
export const createChartWheelSmoothing = ({
  chart,
  canInteract,
  onActivity,
  onFrame,
  requestFrame = (callback) => window.requestAnimationFrame(callback),
  cancelFrame = (frameId) => window.cancelAnimationFrame(frameId),
}: ChartWheelSmoothingOptions): ChartWheelSmoothing => {
  let disposed = false;
  let frameId: number | null = null;
  let zoomRemaining = 0;
  let panRemaining = 0;
  let anchor = 0;
  let lastFrameTime: number | null = null;
  let elapsedSinceInput = 0;

  const cancel = () => {
    if (frameId !== null) cancelFrame(frameId);
    frameId = null;
    zoomRemaining = 0;
    panRemaining = 0;
    lastFrameTime = null;
    elapsedSinceInput = 0;
  };

  const readViewport = () => {
    try {
      if (disposed || !canInteract()) return null;
      const options = chart.options();
      const zoomEnabled = typeof options.handleScale === 'boolean'
        ? options.handleScale : options.handleScale.mouseWheel;
      const panEnabled = typeof options.handleScroll === 'boolean'
        ? options.handleScroll : options.handleScroll.mouseWheel;
      if (!zoomEnabled && !panEnabled) return null;
      const timeScale = chart.timeScale();
      const range = timeScale.getVisibleLogicalRange();
      const timeOptions = timeScale.options();
      const spacing = timeOptions.barSpacing;
      const width = timeScale.width();
      const rightOffset = timeScale.scrollPosition();
      if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)
        || !Number.isFinite(spacing) || spacing <= 0
        || !Number.isFinite(width) || width <= 0 || !Number.isFinite(rightOffset)) return null;
      const minimum = Number.isFinite(timeOptions.minBarSpacing) && timeOptions.minBarSpacing > 0
        ? timeOptions.minBarSpacing : 0.5;
      // A configured maximum supersedes the library's default half-width cap.
      const maximum = Math.max(minimum, timeOptions.maxBarSpacing > 0
        && Number.isFinite(timeOptions.maxBarSpacing) ? timeOptions.maxBarSpacing : width / 2);
      return { timeScale, timeOptions, spacing, width, rightOffset, minimum, maximum, zoomEnabled, panEnabled };
    } catch {
      // Public APIs can throw when a chart is disposed between input and a frame.
      return null;
    }
  };

  const clampSpacing = (spacing: number, minimum: number, maximum: number) => (
    Math.max(minimum, Math.min(maximum, spacing))
  );

  const animate: FrameRequestCallback = (timestamp) => {
    frameId = null;
    const viewport = readViewport();
    if (!viewport) { cancel(); return; }
    if (!viewport.zoomEnabled) zoomRemaining = 0;
    if (!viewport.panEnabled) panRemaining = 0;
    if (zoomRemaining === 0 && panRemaining === 0) { cancel(); return; }

    const elapsedMs = lastFrameTime === null
      ? 1000 / 60 : Math.max(0, timestamp - lastFrameTime);
    const deltaMs = Math.max(1, Math.min(64, elapsedMs));
    lastFrameTime = timestamp;
    elapsedSinceInput += elapsedMs;
    const finish = elapsedSinceInput >= 160
      || (Math.abs(zoomRemaining) < 1e-7 && Math.abs(panRemaining) < 0.01);
    const fraction = finish ? 1 : 1 - Math.exp(-deltaMs / 35);

    const { spacing, minimum, maximum, width, rightOffset, timeOptions, timeScale } = viewport;
    const targetSpacing = clampSpacing(spacing * Math.exp(zoomRemaining), minimum, maximum);
    zoomRemaining = Math.log(targetSpacing / spacing);
    const nextSpacing = clampSpacing(spacing * Math.exp(zoomRemaining * fraction), minimum, maximum);
    zoomRemaining -= Math.log(nextSpacing / spacing);
    const panStep = panRemaining * fraction;
    panRemaining -= panStep;

    const nextOptions: { barSpacing?: number; rightOffset?: number } = {};
    if (nextSpacing !== spacing) nextOptions.barSpacing = nextSpacing;
    const anchorCorrection = !timeOptions.rightBarStaysOnScroll && nextSpacing !== spacing
      ? (width - 1 - Math.max(1, Math.min(anchor, width))) * (1 / nextSpacing - 1 / spacing)
      : 0;
    if (panStep !== 0 || anchorCorrection !== 0) {
      // Native deltaX moves the chart left, increasing the visible right offset.
      nextOptions.rightOffset = rightOffset + anchorCorrection + panStep / nextSpacing;
    }
    try {
      onActivity();
      if (Object.keys(nextOptions).length > 0) {
        timeScale.applyOptions(nextOptions);
        onFrame();
      }
    } catch { cancel(); return; }

    if (finish) { cancel(); return; }
    // Queue after applyOptions so the library commits this transform before
    // the next controller frame reads its actual spacing and scroll position.
    if (!disposed) frameId = requestFrame(animate);
  };

  return {
    handleWheel: (event, anchorX) => {
      const viewport = readViewport();
      const normalized = normalizeChartWheelInput(event);
      if (!viewport || !normalized || !Number.isFinite(anchorX)) { cancel(); return false; }
      const zoom = viewport.zoomEnabled ? normalized.zoom : 0;
      const pan = viewport.panEnabled ? normalized.panPixels : 0;
      if (zoom === 0 && pan === 0) { cancel(); return false; }
      // Reverse from the current viewport without first draining old momentum.
      if (zoom !== 0 && Math.sign(zoom) !== Math.sign(zoomRemaining)) zoomRemaining = 0;
      if (pan !== 0 && Math.sign(pan) !== Math.sign(panRemaining)) panRemaining = 0;
      const targetSpacing = clampSpacing(
        viewport.spacing * Math.exp(zoomRemaining) * (1 + zoom / 10),
        viewport.minimum,
        viewport.maximum,
      );
      zoomRemaining = Math.log(targetSpacing / viewport.spacing);
      const combinedPan = panRemaining + pan;
      panRemaining = Number.isFinite(combinedPan) ? combinedPan : pan;
      anchor = anchorX;
      elapsedSinceInput = 0;
      onActivity();
      if (frameId === null) frameId = requestFrame(animate);
      return true;
    },
    cancel,
    dispose: () => { disposed = true; cancel(); },
  };
};
