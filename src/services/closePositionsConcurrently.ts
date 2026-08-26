export type ClosePositionsConcurrentlyResult = {
  confirmedTicketIds: number[];
  failedTicketIds: number[];
  failedReasons: unknown[];
};

export const closePositionsConcurrently = async (
  candidates: readonly { id: number }[],
  closePosition: (ticketId: number) => Promise<unknown>,
): Promise<ClosePositionsConcurrentlyResult> => {
  const results = await Promise.allSettled(
    candidates.map(async ({ id }) => {
      await closePosition(id);
      return id;
    }),
  );

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
