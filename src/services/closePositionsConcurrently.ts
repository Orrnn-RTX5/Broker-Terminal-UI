export type ClosePositionsConcurrentlyResult = {
  confirmedTicketIds: number[];
  failedTicketIds: number[];
  failedReasons: unknown[];
};

// Gateway admission is deliberately capped per account.  Keep one capacity
// slot available for an explicit single-position close or an order-state read,
// rather than making Close All turn into a burst of rejected commands.
export const MAX_PARALLEL_POSITION_CLOSES = 3;
const MAX_RATE_LIMIT_RETRIES = 8;
const RATE_LIMIT_RETRY_BASE_MS = 80;

const isRetryableCloseRateLimitError = (reason: unknown): boolean => {
  if (!reason || typeof reason !== 'object') return false;
  const candidate = reason as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
    data?: { code?: unknown; error?: unknown; message?: unknown } | null;
  };
  if (Number(candidate.status) === 429) return true;
  const code = String(candidate.code ?? candidate.data?.code ?? candidate.data?.error ?? '').toUpperCase();
  if (code === 'ORDER_RATE_LIMITED' || code === 'TOO_MANY_ORDERS') return true;
  const message = String(candidate.message ?? candidate.data?.message ?? '');
  return /order rate limit exceeded|too many orders are already in flight/i.test(message);
};

const sleepMs = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

export const closePositionsConcurrently = async (
  candidates: readonly { id: number }[],
  closePosition: (ticketId: number) => Promise<unknown>,
  options: { retryDelayMs?: number } = {},
): Promise<ClosePositionsConcurrentlyResult> => {
  const results: PromiseSettledResult<number>[] = new Array(candidates.length);
  let nextCandidateIndex = 0;
  const baseDelayMs = options.retryDelayMs ?? RATE_LIMIT_RETRY_BASE_MS;

  const closeWithRateLimitRetry = async (id: number): Promise<void> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await closePosition(id);
        return;
      } catch (reason) {
        if (attempt >= MAX_RATE_LIMIT_RETRIES || !isRetryableCloseRateLimitError(reason)) {
          throw reason;
        }
        await sleepMs(baseDelayMs * (attempt + 1));
      }
    }
  };

  const worker = async () => {
    while (true) {
      const candidateIndex = nextCandidateIndex;
      nextCandidateIndex += 1;
      if (candidateIndex >= candidates.length) return;

      const { id } = candidates[candidateIndex];
      try {
        await closeWithRateLimitRetry(id);
        results[candidateIndex] = { status: 'fulfilled', value: id };
      } catch (reason) {
        results[candidateIndex] = { status: 'rejected', reason };
      }
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(MAX_PARALLEL_POSITION_CLOSES, candidates.length) },
    () => worker(),
  ));

  const confirmedTicketIds: number[] = [];
  const failedTicketIds: number[] = [];
  const failedReasons: unknown[] = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      confirmedTicketIds.push(result.value);
      return;
    }

    failedTicketIds.push(candidates[index].id);
    failedReasons.push(result.reason);
  });

  return {
    confirmedTicketIds,
    failedTicketIds,
    failedReasons,
  };
};
