import { describe, expect, it } from 'vitest';
import { createRenderLatencyCollector } from './renderLatency';

describe('same-clock render latency collection', () => {
  it('correlates once and keeps pending/dropped outcomes visible', () => {
    const collector = createRenderLatencyCollector(2);
    collector.received('a', 10);
    collector.received('a', 20);
    collector.received('b', 30);
    expect(collector.painted('a', 50)?.elapsedMs).toBe(40);
    expect(collector.painted('a', 70)).toBeNull();
    expect(collector.painted('unknown', 80)).toBeNull();
    collector.received('c', 90);
    collector.received('d', 100);
    expect(collector.report()).toMatchObject({ count: 1, pending: 2, dropped: 1, p95Ms: 40, p99Ms: 40 });
  });

  it('reports nearest-rank percentiles without clipping slow samples', () => {
    const collector = createRenderLatencyCollector();
    for (let i = 1; i <= 100; i++) { collector.received(String(i), 0); collector.painted(String(i), i * 10); }
    expect(collector.report()).toMatchObject({ count: 100, p95Ms: 950, p99Ms: 990, pending: 0, dropped: 0 });
  });

  it('rejects backwards and nonfinite clock observations', () => {
    const collector = createRenderLatencyCollector();
    collector.received('a', 100);
    expect(collector.painted('a', 99)).toBeNull();
    expect(collector.painted('a', NaN)).toBeNull();
    expect(collector.report()).toMatchObject({ count: 0, pending: 1, p95Ms: null });
  });
});
