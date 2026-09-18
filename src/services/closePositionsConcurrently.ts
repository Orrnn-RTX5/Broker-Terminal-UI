export type ClosePositionsConcurrentlyResult = {
  confirmedTicketIds: number[];
  failedTicketIds: number[];
  failedReasons: unknown[];
};

// Gateway admission is deliberately capped per account.  Keep one capacity
// slot available for an explicit single-position close or an order-state read,
// rather than making Close All turn into a burst of rejected commands.
export const MAX_PARALLEL_POSITION_CLOSES = 3;

export const closePositionsConcurrently = async (
  candidates: readonly { id: number }[],
  closePosition: (ticketId: number) => Promise<unknown>,
): Promise<ClosePositionsConcurrentlyResult> => {
  const results: PromiseSettledResult<number>[] = new Array(candidates.length);
  let nextCandidateIndex = 0;

  const worker = async () => {
    while (true) {
      const candidateIndex = nextCandidateIndex;
      nextCandidateIndex += 1;
      if (candidateIndex >= candidates.length) return;

      const { id } = candidates[candidateIndex];
      try {
        await closePosition(id);
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
