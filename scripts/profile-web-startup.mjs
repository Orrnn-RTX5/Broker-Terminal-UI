// Local production startup profiler. No credentials or request headers are
// collected; only public candle limit/timeframe query fields are retained.
// node scripts/profile-web-startup.mjs <build-directory> <port> [sample-name]
// A sample prefix gives hashed assets new cache keys without clearing the user's
// browser cache or changing the origin allowed by the broker's CORS policy.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(process.argv[2] || 'dist');
const port = Number(process.argv[3] || 5181);
const defaultSample = (process.argv[4] || 'sample').replace(/[^a-z0-9_-]/gi, '');
const contentTypes = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
};
const profileScript = `
(() => {
  performance.setResourceTimingBufferSize(2000);
  const phases = {}, tasks = [], paints = {}, animationFrames = [];
  const visibilityChanges = [{at:performance.now(),state:document.visibilityState}];
  document.addEventListener('visibilitychange', () => visibilityChanges.push({at:performance.now(),state:document.visibilityState}));
  const output = document.createElement('script');
  output.id = 'rtx-startup-profile'; output.type = 'application/json';
  document.head.appendChild(output);
  const round = n => Math.round(n * 10) / 10;
  const phase = name => { if (!(name in phases)) phases[name] = round(performance.now()); };
  let completed = false;
  const safeUrl = value => {
    const url = new URL(value, location.href);
    const query = new URLSearchParams();
    for (const key of ['limit', 'timeframe']) {
      const value = url.searchParams.get(key);
      if (value && /^[a-z0-9]{1,8}$/i.test(value)) query.set(key, value);
    }
    return url.origin + url.pathname.replace(/\\b[0-9]{5,}\\b/g, '[id]')
      .replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi, '[id]') + (query.size ? '?' + query : '');
  };
  const snapshot = () => {
    const nav = performance.getEntriesByType('navigation')[0];
    output.textContent = JSON.stringify({
      capturedAtMs: round(performance.now()), phases, paints,
      visibility: document.visibilityState, focused: document.hasFocus(), visibilityChanges,
      navigation: nav && Object.fromEntries(['type','startTime','domainLookupStart','domainLookupEnd',
        'connectStart','connectEnd','secureConnectionStart','requestStart','responseStart',
        'responseEnd','domInteractive','domContentLoadedEventEnd','loadEventEnd',
        'transferSize','encodedBodySize','decodedBodySize','nextHopProtocol']
        .map(key => [key, typeof nav[key] === 'number' ? round(nav[key]) : nav[key]])),
      resources: performance.getEntriesByType('resource')
        .filter(entry => !phases.terminalReady || entry.startTime <= phases.terminalReady)
        .map(entry => ({ name: safeUrl(entry.name), type: entry.initiatorType,
          start: round(entry.startTime), duration: round(entry.duration), end: round(entry.responseEnd),
          dns: round(entry.domainLookupEnd - entry.domainLookupStart),
          connect: round(entry.connectEnd - entry.connectStart),
          tls: entry.secureConnectionStart ? round(entry.connectEnd - entry.secureConnectionStart) : 0,
          ttfb: entry.requestStart ? round(entry.responseStart - entry.requestStart) : null,
          transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize,
          decodedBodySize: entry.decodedBodySize, protocol: entry.nextHopProtocol,
          detailedTimingAvailable: entry.requestStart > 0,
          serverTiming: (entry.serverTiming || [])
            .filter(metric => ['auth','account_metrics','history_upstream','history_read'].includes(metric.name))
            .map(metric => ({name:metric.name,duration:round(metric.duration)})) })),
      postReadyHistory: performance.getEntriesByType('resource')
        .filter(entry => phases.terminalReady && entry.startTime >= phases.terminalReady
          && /\\/candles\\//.test(new URL(entry.name).pathname))
        .map(entry => ({name:safeUrl(entry.name),start:round(entry.startTime),duration:round(entry.duration)})),
      longTasks: tasks.filter(task => !phases.terminalReady || task.start < phases.terminalReady),
      longAnimationFrames: animationFrames.filter(frame => !phases.terminalReady || frame.start < phases.terminalReady),
    });
  };
  try { new PerformanceObserver(list => {
    list.getEntries().forEach(entry => { paints[entry.name] = round(entry.startTime); });
  }).observe({type:'paint',buffered:true}); } catch {}
  try { new PerformanceObserver(list => {
    list.getEntries().forEach(entry => tasks.push({start:round(entry.startTime),duration:round(entry.duration)}));
  }).observe({type:'longtask',buffered:true}); } catch {}
  try { new PerformanceObserver(list => {
    list.getEntries().forEach(entry => animationFrames.push({
      start:round(entry.startTime), duration:round(entry.duration),
      blockingDuration:round(entry.blockingDuration), renderStart:round(entry.renderStart),
      styleAndLayoutStart:round(entry.styleAndLayoutStart),
      scripts:entry.scripts.map(script => ({
        start:round(script.startTime), duration:round(script.duration),
        sourceURL:script.sourceURL ? safeUrl(script.sourceURL) : '',
        sourceFunctionName:script.sourceFunctionName, sourceCharPosition:script.sourceCharPosition,
        invokerType:script.invokerType,
        forcedStyleAndLayoutDuration:round(script.forcedStyleAndLayoutDuration),
        pauseDuration:round(script.pauseDuration),
      })),
    }));
  }).observe({type:'long-animation-frame',buffered:true}); } catch {}
  const observer = new MutationObserver(() => {
    const boundary = document.querySelector('[data-terminal-startup]');
    if (!boundary) return;
    phase('workspaceMounted');
    for (const part of ['data','chart','market-watch']) {
      if (boundary.getAttribute('data-terminal-startup-' + part + '-ready') === 'true') phase(part + 'Ready');
      else delete phases[part + 'Ready'];
    }
    if (!completed && boundary.getAttribute('data-terminal-startup') === 'ready') {
      completed = true; observer.disconnect();
      phase('terminalReadyGate');
      requestAnimationFrame(() => setTimeout(() => { phase('terminalReady'); snapshot(); setTimeout(snapshot, 2000); }, 0));
    }
  });
  observer.observe(document.documentElement, {subtree:true,childList:true,attributes:true,
    attributeFilter:['data-terminal-startup','data-terminal-startup-data-ready',
      'data-terminal-startup-chart-ready','data-terminal-startup-market-watch-ready']});
  document.addEventListener('DOMContentLoaded', () => { phase('domContentLoaded'); snapshot(); });
  window.addEventListener('load', () => { phase('windowLoad'); setTimeout(snapshot, 0); });
  setTimeout(snapshot, 30000);
})();
`;
const cache = new Map();
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const requestedSample = (url.searchParams.get('startup-sample') || defaultSample).replace(/[^a-z0-9_-]/gi, '');
    const assetSample = url.pathname.match(/^\/__startup_sample\/([a-z0-9_-]+)\/assets\//i)?.[1];
    const assetPrefix = '/__startup_sample/' + (assetSample || requestedSample) + '/assets/';
    const pathname = url.pathname.startsWith(assetPrefix)
      ? '/assets/' + url.pathname.slice(assetPrefix.length) : url.pathname;
    let filename = resolve(root, '.' + decodeURIComponent(pathname));
    if (filename !== root && !filename.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    try { if (!(await stat(filename)).isFile()) filename = resolve(root, 'index.html'); }
    catch { if (extname(filename)) { res.writeHead(404).end(); return; } filename = resolve(root, 'index.html'); }
    const cacheKey = filename + '|' + assetPrefix;
    let entry = cache.get(cacheKey);
    if (!entry) {
      const type = contentTypes[extname(filename)] || 'application/octet-stream';
      let body = await readFile(filename);
      if (/\.(html|js|css)$/.test(filename)) body = Buffer.from(body.toString().replaceAll('/assets/', assetPrefix));
      if (filename === resolve(root, 'index.html')) {
        body = Buffer.from(body.toString().replace('<head>', '<head><script>' + profileScript + '</script>'));
      }
      entry = {body, type, gzip: body.length >= 1024 && /^(text\/|application\/(javascript|json)|image\/svg)/.test(type) ? gzipSync(body, {level:6}) : null};
      cache.set(cacheKey, entry);
    }
    const compressed = entry.gzip && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    res.writeHead(200, {'Content-Type':entry.type, 'Vary':'Accept-Encoding',
      'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
      ...(compressed ? {'Content-Encoding':'gzip'} : {})});
    res.end(compressed ? entry.gzip : entry.body);
  } catch (error) { res.writeHead(500).end('Local profiling server error'); console.error(error.message); }
});
server.listen(port, '127.0.0.1', () => console.log('Startup profiler: http://127.0.0.1:' + port));
