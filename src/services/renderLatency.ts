export interface RenderLatencySample {
  correlation: string;
  receivedAt: number;
  paintedAt: number;
  elapsedMs: number;
}

// Both timestamps must come from the same monotonic clock. Server epoch
// timestamps and network RTT cannot be substituted for browser receipt time.
export function createRenderLatencyCollector(capacity = 4096) {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Invalid sample capacity');
  const pending = new Map<string, number>();
  const completed = new Set<string>();
  const samples: RenderLatencySample[] = [];
  let dropped = 0;
  return {
    received(correlation: string, now: number) {
      if (!correlation || !Number.isFinite(now) || now < 0 || pending.has(correlation) || completed.has(correlation)) return;
      if (pending.size >= capacity) {
        pending.delete(pending.keys().next().value!);
        dropped++;
      }
      pending.set(correlation, now);
    },
    painted(correlation: string, now: number): RenderLatencySample | null {
      const receivedAt = pending.get(correlation);
      if (receivedAt === undefined || !Number.isFinite(now) || now < receivedAt) return null;
      pending.delete(correlation);
      const sample = { correlation, receivedAt, paintedAt: now, elapsedMs: now - receivedAt };
      if (samples.length >= capacity) {
        completed.delete(samples.shift()!.correlation);
        dropped++;
      }
      completed.add(correlation);
      samples.push(sample);
      return sample;
    },
    report() {
      const sorted = samples.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
      const percentile = (p: number) => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
      return { metric: 'browser-receipt-to-paint', count: samples.length, pending: pending.size, dropped, p95Ms: percentile(0.95), p99Ms: percentile(0.99), samples: [...samples] };
    },
  };
}
