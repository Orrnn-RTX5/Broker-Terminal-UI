/** Shared read-only budget for burst reconciliation; never queues order submissions. */
export const ORDER_STATUS_MAX_CONCURRENT_READS = 4;
export const ORDER_STATUS_READ_SPACING_MS = 100;
const MAX_QUEUED_READS = 256;
type Job = { start: () => void; signal?: AbortSignal; cancel: () => void };
const queue: Job[] = [];
let active = 0;
let lastStarted = -Infinity;
let timer: ReturnType<typeof setTimeout> | undefined;
const aborted = () => new DOMException('Order status read cancelled', 'AbortError');
function pump(): void {
  if (timer !== undefined || active >= ORDER_STATUS_MAX_CONCURRENT_READS || !queue.length) return;
  const delay = ORDER_STATUS_READ_SPACING_MS - (performance.now() - lastStarted);
  if (delay > 0) { timer = setTimeout(() => { timer = undefined; pump(); }, delay); return; }
  const job = queue.shift()!;
  job.signal?.removeEventListener('abort', job.cancel);
  if (job.signal?.aborted) { job.cancel(); pump(); return; }
  active++; lastStarted = performance.now(); job.start();
  pump();
}
export function scheduleOrderStatusRead<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(aborted());
  if (queue.length >= MAX_QUEUED_READS) return Promise.reject(new Error('Order status reader is busy'));
  return new Promise<T>((resolve, reject) => {
    const job: Job = { signal,
      cancel: () => { const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1); reject(aborted()); },
      start: () => { void Promise.resolve().then(read).then(resolve, reject).finally(() => { active--; pump(); }); },
    };
    signal?.addEventListener('abort', job.cancel, { once: true });
    queue.push(job); pump();
  });
}
