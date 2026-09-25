/**
 * Screenshot Service
 * Captures the full application window and opens it in a preview tab.
 * Subscribes to EXPORT_CHART commands from the command bus.
 */

import { commandBus } from './commandBus';

type ScreenshotRenderer = typeof import('html2canvas-pro')['default'];

let renderer: ScreenshotRenderer | null = null;
let rendererPromise: Promise<ScreenshotRenderer> | null = null;
let captureInFlight: Promise<void> | null = null;

const MAX_SCREENSHOT_PIXELS = 36_000_000;
const MAX_SCREENSHOT_EDGE = 16_384;

type CaptureBounds = {
  width: number;
  height: number;
};

const loadScreenshotRenderer = (): Promise<ScreenshotRenderer> => {
  if (!rendererPromise) {
    rendererPromise = import('html2canvas-pro')
      .then((module) => {
        renderer = module.default;
        return renderer;
      })
      .catch((error) => {
        renderer = null;
        rendererPromise = null;
        throw error;
      });
  }

  return rendererPromise;
};

/** Optional explicit warmup; importing the service does not load the renderer. */
const preloadScreenshotRenderer = (): Promise<void> => loadScreenshotRenderer()
  .then(() => undefined)
  .catch((error) => {
    console.warn('[Screenshot] Renderer preload failed; the next capture will retry.', error);
  });

const canvasToPngBlob = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) {
      resolve(blob);
      return;
    }

    reject(new Error('The browser could not encode the screenshot.'));
  }, 'image/png');
});

const getFullScreenCaptureBounds = (): CaptureBounds => {
  const root = document.getElementById('root');
  const documentElement = document.documentElement;

  return {
    // The terminal is a viewport application. Capturing scroll dimensions can
    // reflow its cloned layout and stretch the chart's existing bitmap canvases.
    width: Math.ceil(Math.max(1, window.innerWidth, documentElement.clientWidth, root?.clientWidth ?? 0)),
    height: Math.ceil(Math.max(1, window.innerHeight, documentElement.clientHeight, root?.clientHeight ?? 0)),
  };
};

const getScreenshotScale = ({ width, height }: CaptureBounds): number => {
  const deviceScale = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
    ? window.devicePixelRatio
    : 1;
  // Match the browser's physical pixel density. Artificially enlarging a DPR 1
  // chart to 2x only resamples its existing bitmap and makes it look softer.
  const outputWidth = width * deviceScale;
  const outputHeight = height * deviceScale;
  const outputPixels = outputWidth * outputHeight;

  if (outputWidth > MAX_SCREENSHOT_EDGE
    || outputHeight > MAX_SCREENSHOT_EDGE
    || outputPixels > MAX_SCREENSHOT_PIXELS) {
    throw new Error('The visible screen is too large to capture safely as one PNG.');
  }

  return deviceScale;
};

const renderFullScreen = (
  html2canvas: ScreenshotRenderer,
  { width, height }: CaptureBounds,
  scale: number,
): Promise<HTMLCanvasElement> => html2canvas(document.documentElement, {
  backgroundColor: '#0d0d0d',
  scale,
  useCORS: true,
  logging: false,
  enablePerformanceMonitoring: false,
  imageSmoothing: true,
  imageSmoothingQuality: 'high',
  x: 0,
  y: 0,
  scrollX: 0,
  scrollY: 0,
  width,
  height,
  windowWidth: width,
  windowHeight: height,
});

const canUsePreviewWindow = (previewWindow: Window | null): previewWindow is Window => {
  if (!previewWindow) return false;

  try {
    return !previewWindow.closed && Boolean(previewWindow.document);
  } catch {
    return false;
  }
};

const writeCapturingPreview = (previewWindow: Window, timestamp: string): void => {
  previewWindow.document.open();
  previewWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Capturing screenshot...</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #0d0d0d;
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    }
    .capture-status { display: flex; align-items: center; gap: 12px; font-size: 14px; }
    .spinner {
      width: 18px;
      height: 18px;
      border: 2px solid #3f3f46;
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="capture-status" role="status" aria-live="polite">
    <span class="spinner" aria-hidden="true"></span>
    <span>Capturing screenshot...</span>
  </div>
  <span hidden>${timestamp}</span>
</body>
</html>`);
  previewWindow.document.close();
};

const writeScreenshotPreview = (
  previewWindow: Window,
  imageUrl: string,
  filename: string,
  timestamp: string,
  { width: imageWidth, height: imageHeight }: CaptureBounds,
): void => {
  previewWindow.document.open();
  previewWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Screenshot - ${timestamp}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0d0d0d;
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
    }
    .header {
      position: fixed;
      z-index: 2;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: calc(100vw - 32px);
      max-width: 1400px;
      padding: 12px 16px;
      background: rgba(30, 30, 30, 0.94);
      border: 1px solid #2a2e39;
      border-radius: 8px;
      box-shadow: 0 8px 28px rgba(0,0,0,0.45);
      backdrop-filter: blur(8px);
    }
    .header h2 { font-size: 15px; font-weight: 600; color: #3b82f6; }
    .header span { font-size: 12px; color: #71717a; }
    .actions { display: flex; gap: 8px; }
    .btn {
      padding: 8px 20px;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      text-decoration: none;
    }
    .btn-primary { background: #3b82f6; color: white; }
    .btn-primary:hover { background: #2563eb; }
    .btn-secondary { background: #27272a; color: #a1a1aa; border: 1px solid #3f3f46; }
    .btn-secondary:hover { background: #3f3f46; color: white; }
    .image-container {
      position: fixed;
      inset: 0;
      z-index: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background: #0d0d0d;
    }
    img {
      display: block;
      object-position: center;
      image-rendering: auto;
    }
    .image-container.fit-screen img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .image-container.actual-size {
      align-items: flex-start;
      justify-content: flex-start;
      overflow: auto;
    }
    .image-container.actual-size img {
      flex: 0 0 auto;
      width: ${imageWidth}px;
      height: ${imageHeight}px;
      max-width: none;
      max-height: none;
      object-fit: fill;
    }

    @media print {
      html,
      body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: auto;
        overflow: visible;
        background: #0d0d0d !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .header { display: none !important; }
      .image-container {
        position: static !important;
        display: block !important;
        width: 100% !important;
        height: auto !important;
        overflow: visible !important;
      }
      .image-container img {
        width: 100% !important;
        height: auto !important;
        max-width: 100% !important;
        max-height: none !important;
        object-fit: contain !important;
        page-break-inside: avoid;
      }
      @page { margin: 0; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h2>📷 Full Screenshot</h2>
      <span>${new Date().toLocaleString()}</span>
    </div>
    <div class="actions">
      <button class="btn btn-secondary" id="viewModeBtn" type="button" aria-pressed="false" onclick="toggleViewMode()">
        100% pixels
      </button>
      <button class="btn btn-secondary" onclick="window.print()">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
        Print PDF
      </button>
      <a class="btn btn-primary" id="downloadBtn" href="${imageUrl}" download="${filename}">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        Download PNG
      </a>
    </div>
  </div>
  <div class="image-container fit-screen" id="imageContainer">
    <img id="screenshotImage" src="${imageUrl}" alt="Full Screenshot" />
  </div>
  <script>
    const imageContainer = document.getElementById('imageContainer');
    const screenshotImage = document.getElementById('screenshotImage');
    const viewModeBtn = document.getElementById('viewModeBtn');

    function setActualSize(enabled) {
      imageContainer.classList.toggle('actual-size', enabled);
      imageContainer.classList.toggle('fit-screen', !enabled);
      viewModeBtn.setAttribute('aria-pressed', String(enabled));
      viewModeBtn.textContent = enabled ? 'Fit screen' : '100% pixels';
    }

    function toggleViewMode() {
      setActualSize(!imageContainer.classList.contains('actual-size'));
    }

    function selectSharpestInitialView() {
      const imageFitsAtOneToOne = ${imageWidth} <= imageContainer.clientWidth && ${imageHeight} <= imageContainer.clientHeight;
      setActualSize(imageFitsAtOneToOne);
    }

    screenshotImage.addEventListener('load', selectSharpestInitialView, { once: true });
    if (screenshotImage.complete) selectSharpestInitialView();
  </script>
</body>
</html>`);
  previewWindow.document.close();
};

const writeCaptureError = (previewWindow: Window, message: string): void => {
  previewWindow.document.open();
  previewWindow.document.write(`<!DOCTYPE html>
<html>
<head><title>Screenshot failed</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0d0d;color:#fca5a5;font-family:system-ui,sans-serif">
  <div role="alert">Screenshot failed. Please return to the terminal and try again.</div>
  <span hidden>${message.replace(/[<>&]/g, '')}</span>
</body>
</html>`);
  previewWindow.document.close();
};

const downloadScreenshot = (blob: Blob, filename: string): void => {
  const imageUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.style.display = 'none';
  anchor.href = imageUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(imageUrl), 60_000);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
};

const runFullPageCapture = async (): Promise<void> => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `screenshot-${timestamp}.png`;
  const captureBounds = getFullScreenCaptureBounds();
  let canvasPromise: Promise<HTMLCanvasElement> | null = null;
  let previewWindow: Window | null = null;
  let previewWasInitialized = false;

  // Reserve and paint the preview during the click gesture so the user gets an
  // immediate response. The expensive full-resolution render continues behind it.
  try {
    previewWindow = window.open('', '_blank');
    if (canUsePreviewWindow(previewWindow)) {
      writeCapturingPreview(previewWindow, timestamp);
      previewWasInitialized = true;
    } else {
      previewWindow = null;
    }
  } catch (error) {
    try {
      previewWindow?.close();
    } catch {
      // The popup proxy can become inaccessible immediately under COOP.
    }
    previewWindow = null;
    console.warn('[Screenshot] Preview could not be opened; capture will download directly.', error);
  }

  try {
    const captureScale = getScreenshotScale(captureBounds);

    if (renderer) {
      canvasPromise = renderFullScreen(renderer, captureBounds, captureScale);
    }

    if (!canvasPromise) {
      const html2canvas = await loadScreenshotRenderer();
      canvasPromise = renderFullScreen(html2canvas, captureBounds, captureScale);
    }

    const canvas = await canvasPromise;
    const blob = await canvasToPngBlob(canvas);

    if (canUsePreviewWindow(previewWindow)) {
      const imageUrl = URL.createObjectURL(blob);

      try {
        writeScreenshotPreview(previewWindow, imageUrl, filename, timestamp, {
          width: canvas.width,
          height: canvas.height,
        });
        let imageUrlWasRevoked = false;
        const revokeImageUrl = (): void => {
          if (imageUrlWasRevoked) return;
          imageUrlWasRevoked = true;
          URL.revokeObjectURL(imageUrl);
        };
        previewWindow.addEventListener('beforeunload', revokeImageUrl, { once: true });
        previewWindow.addEventListener('pagehide', revokeImageUrl, { once: true });
        console.log('[Screenshot] Full page screenshot opened in preview');
        return;
      } catch (error) {
        URL.revokeObjectURL(imageUrl);
        console.warn('[Screenshot] Preview became unavailable before capture completed.', error);
      }
    }

    if (!previewWasInitialized) {
      downloadScreenshot(blob, filename);
      console.log('[Screenshot] Preview was blocked; screenshot downloaded directly');
    }
  } catch (error: unknown) {
    console.error('[Screenshot] Full page capture failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown screenshot error';

    if (canUsePreviewWindow(previewWindow)) {
      try {
        writeCaptureError(previewWindow, message);
      } catch {
        // The preview can be closed or navigated while the capture is rendering.
      }
    } else if (!previewWasInitialized) {
      alert('Screenshot failed. Please check the browser console for details.');
    }
  }
};

/**
 * Capture the full application window. Repeated clicks share the active capture
 * instead of starting multiple expensive DOM renders.
 */
function captureFullPage(): Promise<void> {
  if (captureInFlight) return captureInFlight;

  const trackedCapture = runFullPageCapture().finally(() => {
    if (captureInFlight === trackedCapture) captureInFlight = null;
  });
  captureInFlight = trackedCapture;
  return trackedCapture;
}

// Subscribe at module load so toolbar commands work regardless of component lifecycle.
commandBus.subscribe('EXPORT_CHART', () => {
  void captureFullPage();
});

console.log('[Screenshot] Service initialized — listening for EXPORT_CHART commands');

export { captureFullPage, preloadScreenshotRenderer };
