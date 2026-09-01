import { beforeEach, describe, expect, it, vi } from 'vitest';

const { html2canvasMock } = vi.hoisted(() => ({
  html2canvasMock: vi.fn(),
}));

vi.mock('html2canvas-pro', () => ({
  default: html2canvasMock,
}));

import { captureFullPage, preloadScreenshotRenderer } from './screenshotService';

type PreviewWindowHarness = {
  window: Window;
  documentOpen: ReturnType<typeof vi.fn>;
  documentWrite: ReturnType<typeof vi.fn>;
  documentClose: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

const createPreviewWindow = (): PreviewWindowHarness => {
  const documentOpen = vi.fn();
  const documentWrite = vi.fn();
  const documentClose = vi.fn();
  const addEventListener = vi.fn();
  const close = vi.fn();

  return {
    window: {
      closed: false,
      document: {
        open: documentOpen,
        write: documentWrite,
        close: documentClose,
      },
      addEventListener,
      close,
    } as unknown as Window,
    documentOpen,
    documentWrite,
    documentClose,
    addEventListener,
    close,
  };
};

describe('screenshotService performance path', () => {
  let canvas: HTMLCanvasElement;
  let preview: PreviewWindowHarness;
  let openSpy: ReturnType<typeof vi.spyOn>;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    html2canvasMock.mockReset();

    canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    html2canvasMock.mockResolvedValue(canvas);

    preview = createPreviewWindow();
    openSpy = vi.spyOn(window, 'open').mockReturnValue(preview.window);

    createObjectURL = vi.fn(() => 'blob:screenshot-preview');
    revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectURL,
    });

    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('opens an immediate preview status before starting the full-resolution render', async () => {
    await preloadScreenshotRenderer();
    const callOrder: string[] = [];
    let resolveCanvas: ((value: HTMLCanvasElement) => void) | undefined;
    html2canvasMock.mockImplementation(() => new Promise((resolve) => {
      callOrder.push('capture');
      resolveCanvas = resolve;
    }));
    openSpy.mockImplementation(() => {
      callOrder.push('preview');
      return preview.window;
    });

    const capture = captureFullPage();

    expect(callOrder).toEqual(['preview', 'capture']);
    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    expect(preview.documentWrite).toHaveBeenCalledTimes(1);
    expect(preview.documentWrite.mock.calls[0][0]).toContain('Capturing screenshot...');

    resolveCanvas?.(canvas);
    await capture;
  });

  it('renders a lossless high-density PNG and uses the same full image for preview and download', async () => {
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2);
    const toDataURLSpy = vi.spyOn(canvas, 'toDataURL');
    const expectedWidth = Math.ceil(Math.max(
      window.innerWidth,
      document.documentElement.clientWidth,
      document.getElementById('root')?.clientWidth ?? 0,
      1,
    ));
    const expectedHeight = Math.ceil(Math.max(
      window.innerHeight,
      document.documentElement.clientHeight,
      document.getElementById('root')?.clientHeight ?? 0,
      1,
    ));
    canvas.width = expectedWidth * 2;
    canvas.height = expectedHeight * 2;
    const fullResolutionBlob = new Blob(['full-resolution-png'], { type: 'image/png' });
    const toBlobSpy = vi.spyOn(canvas, 'toBlob').mockImplementation((callback, type) => {
      expect(type).toBe('image/png');
      callback(fullResolutionBlob);
    });
    toBlobSpy.mockClear();

    await captureFullPage();

    expect(html2canvasMock).toHaveBeenCalledTimes(1);
    expect(html2canvasMock).toHaveBeenCalledWith(document.documentElement, expect.objectContaining({
      scale: 2,
      logging: false,
      enablePerformanceMonitoring: false,
      useCORS: true,
      imageSmoothingQuality: 'high',
      width: expectedWidth,
      height: expectedHeight,
      windowWidth: expectedWidth,
      windowHeight: expectedHeight,
    }));
    expect(canvas.width).toBe(expectedWidth * 2);
    expect(canvas.height).toBe(expectedHeight * 2);
    expect(toBlobSpy).toHaveBeenCalledTimes(1);
    expect(toBlobSpy).toHaveBeenCalledWith(expect.any(Function), 'image/png');
    expect(toDataURLSpy).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledWith(fullResolutionBlob);
    expect(preview.documentWrite).toHaveBeenCalledTimes(2);
    const finalPreviewHtml = preview.documentWrite.mock.calls[1][0];
    expect(finalPreviewHtml.match(/blob:screenshot-preview/g)).toHaveLength(2);
    expect(finalPreviewHtml).toContain('download="screenshot-');
    expect(finalPreviewHtml).toMatch(/\.header\s*{\s*position: fixed;/);
    expect(finalPreviewHtml).toMatch(/\.image-container\s*{[\s\S]*?inset: 0;/);
    expect(finalPreviewHtml).toContain('height: 100vh;');
    expect(finalPreviewHtml).toContain('object-fit: contain;');
    expect(finalPreviewHtml).toContain('class="image-container fit-screen"');
    expect(finalPreviewHtml).toContain('class="btn btn-secondary" id="viewModeBtn"');
    expect(finalPreviewHtml).toContain('100% pixels');
    expect(finalPreviewHtml).toContain('selectSharpestInitialView');
    expect(finalPreviewHtml).toContain(`width: ${canvas.width}px;`);
    expect(finalPreviewHtml).toContain(`height: ${canvas.height}px;`);
    expect(finalPreviewHtml).toContain('position: static !important;');
    expect(finalPreviewHtml).toMatch(/\.image-container img\s*{[\s\S]*?width: 100% !important;/);

    const beforeUnloadCall = preview.addEventListener.mock.calls.find(([event]) => event === 'beforeunload');
    const pageHideCall = preview.addEventListener.mock.calls.find(([event]) => event === 'pagehide');
    expect(beforeUnloadCall).toBeDefined();
    expect(pageHideCall).toBeDefined();
    beforeUnloadCall?.[1]();
    pageHideCall?.[1]();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:screenshot-preview');
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('captures the exact visible viewport without resizing or reflowing a cloned root', async () => {
    const fullHeight = window.innerHeight + 500;
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(fullHeight);

    await captureFullPage();

    const [, options] = html2canvasMock.mock.calls[0];
    expect(options).toEqual(expect.objectContaining({
      height: window.innerHeight,
      windowHeight: window.innerHeight,
      scrollY: 0,
    }));
    expect(options.onclone).toBeUndefined();
  });

  it('matches a high-density display pixel ratio instead of resampling the chart at a fixed scale', async () => {
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2.5);

    await captureFullPage();

    expect(html2canvasMock).toHaveBeenCalledWith(document.documentElement, expect.objectContaining({
      scale: 2.5,
    }));
  });

  it('preserves a native sub-1 pixel ratio when the browser is zoomed out', async () => {
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(0.8);

    await captureFullPage();

    expect(html2canvasMock).toHaveBeenCalledWith(document.documentElement, expect.objectContaining({
      scale: 0.8,
    }));
  });

  it('fails safely instead of creating an oversized or silently downscaled PNG', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(20_000);

    await captureFullPage();

    expect(html2canvasMock).not.toHaveBeenCalled();
    expect(preview.documentWrite.mock.calls.some(([html]) => (
      String(html).includes('Screenshot failed')
      && String(html).includes('screen is too large')
    ))).toBe(true);
  });

  it('shares one in-flight capture across rapid repeated clicks', async () => {
    let resolveCanvas: ((value: HTMLCanvasElement) => void) | undefined;
    html2canvasMock.mockReturnValue(new Promise((resolve) => {
      resolveCanvas = resolve;
    }));

    const firstCapture = captureFullPage();
    const secondCapture = captureFullPage();

    expect(secondCapture).toBe(firstCapture);
    expect(openSpy).toHaveBeenCalledTimes(1);

    resolveCanvas?.(canvas);
    await firstCapture;
    expect(html2canvasMock).toHaveBeenCalledTimes(1);
  });

  it('downloads the PNG directly when a preview tab is unavailable', async () => {
    vi.useFakeTimers();
    openSpy.mockReturnValue(null);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    await captureFullPage();
    vi.runAllTimers();

    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:screenshot-preview');
    vi.useRealTimers();
  });

  it('downloads directly when a non-null popup cannot initialize its preview document', async () => {
    vi.useFakeTimers();
    preview.documentOpen.mockImplementation(() => {
      throw new DOMException('Popup is isolated', 'SecurityError');
    });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    await captureFullPage();
    vi.runAllTimers();

    expect(preview.close).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:screenshot-preview');
    vi.useRealTimers();
  });

  it('does not start an unexpected download when the user closes the preview', async () => {
    let resolveCanvas: ((value: HTMLCanvasElement) => void) | undefined;
    html2canvasMock.mockReturnValue(new Promise((resolve) => {
      resolveCanvas = resolve;
    }));
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const capture = captureFullPage();
    Object.defineProperty(preview.window, 'closed', { configurable: true, value: true });
    resolveCanvas?.(canvas);
    await capture;

    expect(anchorClick).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('revokes the Blob URL if the preview navigates before the final image is written', async () => {
    preview.documentWrite
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new DOMException('Permission denied', 'SecurityError');
      });

    await expect(captureFullPage()).resolves.toBeUndefined();

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:screenshot-preview');
  });

  it('clears the single-flight guard after a failed render so the next click retries', async () => {
    html2canvasMock
      .mockRejectedValueOnce(new Error('render failed'))
      .mockResolvedValueOnce(canvas);

    await captureFullPage();
    await captureFullPage();

    expect(openSpy).toHaveBeenCalledTimes(2);
    expect(html2canvasMock).toHaveBeenCalledTimes(2);
    expect(preview.documentWrite.mock.calls.some(([html]) => String(html).includes('Screenshot failed'))).toBe(true);
  });

  it('exposes an awaitable, idempotent preload hook for idle startup warming', async () => {
    await expect(preloadScreenshotRenderer()).resolves.toBeUndefined();
    await expect(preloadScreenshotRenderer()).resolves.toBeUndefined();
  });
});
