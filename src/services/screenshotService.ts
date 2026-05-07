/**
 * Screenshot Service
 * Captures the full application window and opens in a new tab
 * Subscribes to EXPORT_CHART command from the command bus
 */

import { commandBus } from './commandBus';

/**
 * Capture the full page and open in a new tab with preview
 */
async function captureFullPage(): Promise<void> {
  try {
    console.log('[Screenshot] Capturing full page...');

    // Dynamically import html2canvas-pro to avoid bundling issues and support modern CSS
    const html2canvasModule = await import('html2canvas-pro');
    const html2canvas = html2canvasModule.default;

    const canvas = await html2canvas(document.body, {
      backgroundColor: '#0d0d0d',
      scale: 2,
      useCORS: true,
      logging: true,
      windowWidth: document.body.scrollWidth,
      windowHeight: document.body.scrollHeight,
    });

    const imageDataUrl = canvas.toDataURL('image/png');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `screenshot-${timestamp}.png`;

    // Open in a new blank page with preview
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Screenshot - ${timestamp}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0d0d0d;
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
      padding: 20px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      max-width: 1400px;
      margin-bottom: 16px;
      padding: 12px 16px;
      background: #1e1e1e;
      border: 1px solid #2a2e39;
      border-radius: 8px;
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
    }
    .btn-primary { background: #3b82f6; color: white; }
    .btn-primary:hover { background: #2563eb; }
    .btn-secondary { background: #27272a; color: #a1a1aa; border: 1px solid #3f3f46; }
    .btn-secondary:hover { background: #3f3f46; color: white; }
    .image-container {
      border: 1px solid #2a2e39;
      border-radius: 8px;
      overflow: hidden;
      max-width: 100%;
      box-shadow: 0 4px 24px rgba(0,0,0,0.5);
    }
    img { display: block; max-width: 100%; height: auto; }
    
    @media print {
      body {
        margin: 0;
        padding: 0;
        background: #0d0d0d !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .header {
        display: none !important;
      }
      .image-container {
        border: none;
        border-radius: 0;
        box-shadow: none;
        max-width: 100%;
      }
      img {
        max-width: 100%;
        page-break-inside: avoid;
      }
      @page {
        margin: 0;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h2>\u{1F4F7} Full Screenshot</h2>
      <span>${new Date().toLocaleString()}</span>
    </div>
    <div class="actions">
      <button class="btn btn-secondary" onclick="window.print()">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
        Print PDF
      </button>
      <button class="btn btn-primary" id="downloadBtn">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        Download PNG
      </button>
    </div>
  </div>
  <div class="image-container">
    <img id="screenshotImage" src="${imageDataUrl}" alt="Full Screenshot" />
  </div>
  <script>
    document.getElementById('downloadBtn').addEventListener('click', function() {
      // Create robust download using fetch and object URL to bypass some browser data URI restrictions
      const imgSrc = document.getElementById('screenshotImage').src;
      fetch(imgSrc)
        .then(res => res.blob())
        .then(blob => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = url;
          a.download = '${filename}';
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        })
        .catch(err => {
          console.error('Download via blob failed, falling back to direct link', err);
          const a = document.createElement('a');
          a.href = imgSrc;
          a.download = '${filename}';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        });
    });
  </script>
</body>
</html>`);
      win.document.close();
      console.log('[Screenshot] Full page screenshot opened in new tab');
    } else {
      console.error('[Screenshot] Failed to open new tab — popup blocked?');
    }
  } catch (error: any) {
    console.error('[Screenshot] Full page capture failed:');
    console.error(error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Stack trace:', error.stack);
    }
    // Fallback: alert the user
    alert('Screenshot failed. Please check the browser console for details.');
  }
}

// Subscribe to EXPORT_CHART command at module load time
// This ensures the handler is always active regardless of component lifecycle
commandBus.subscribe('EXPORT_CHART', () => {
  captureFullPage();
});

console.log('[Screenshot] Service initialized — listening for EXPORT_CHART commands');

export { captureFullPage };
