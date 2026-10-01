import {
  closePositionsConcurrently,
  type ClosePositionsConcurrentlyResult,
} from './closePositionsConcurrently';

export type LocalFirstCloseCandidate = {
  id: number;
};

export type LocalFirstCloseOptions<TCandidate extends LocalFirstCloseCandidate> = {
  sessionKey: string;
  getCurrentSessionKey: () => string | null;
  localCandidates: readonly TCandidate[];
  loadAuthoritativeCandidates: () => Promise<readonly TCandidate[]>;
  closePosition: (ticketId: number, candidate: TCandidate) => Promise<unknown>;
  tryClaimTicket?: (ticketId: number) => boolean;
  onCandidatesStarted?: (candidates: readonly TCandidate[]) => void;
  /** Fires as soon as the backend confirms one ticket's close, before the batch settles. */
  onTicketConfirmed?: (ticketId: number) => void;
};

export type LocalFirstCloseResult = ClosePositionsConcurrentlyResult & {
  attemptedTicketIds: number[];
  skippedTicketIds: number[];
  authoritativeSnapshotError: unknown | null;
  sessionCurrent: boolean;
};

const EMPTY_CLOSE_RESULT: ClosePositionsConcurrentlyResult = {
  confirmedTicketIds: [],
  failedTicketIds: [],
  failedReasons: [],
};

const mergeCloseResults = (
  first: ClosePositionsConcurrentlyResult,
  second: ClosePositionsConcurrentlyResult,
): ClosePositionsConcurrentlyResult => ({
  confirmedTicketIds: [...first.confirmedTicketIds, ...second.confirmedTicketIds],
  failedTicketIds: [...first.failedTicketIds, ...second.failedTicketIds],
  failedReasons: [...first.failedReasons, ...second.failedReasons],
});

export const closePositionsLocalFirst = async <TCandidate extends LocalFirstCloseCandidate>(
  options: LocalFirstCloseOptions<TCandidate>,
): Promise<LocalFirstCloseResult> => {
  const {
    sessionKey,
    getCurrentSessionKey,
    localCandidates,
    loadAuthoritativeCandidates,
    tryClaimTicket,
    onCandidatesStarted,
    onTicketConfirmed,
  } = options;

  const isSessionCurrent = () => getCurrentSessionKey() === sessionKey;
  const closePosition = async (ticketId: number, candidate: TCandidate) => {
    const result = await options.closePosition(ticketId, candidate);
    // The close is already confirmed by the backend; a UI callback failure
    // must not report this ticket as failed.
    try {
      onTicketConfirmed?.(ticketId);
    } catch (error) {
      console.error(`[Close] Confirmed-close handler failed for ticket ${ticketId}:`, error);
    }
    return result;
  };
  if (!isSessionCurrent()) {
    return {
      ...EMPTY_CLOSE_RESULT,
      attemptedTicketIds: [],
      skippedTicketIds: [],
      authoritativeSnapshotError: null,
      sessionCurrent: false,
    };
  }

  const seenTicketIds = new Set<number>();
  const candidatesById = new Map<number, TCandidate>();
  const closeCurrentPosition = (ticketId: number) => {
    if (!isSessionCurrent()) return Promise.reject(new Error('Trading session changed; close cancelled'));
    return closePosition(ticketId, candidatesById.get(ticketId)!);
  };
  const attemptedTicketIds: number[] = [];
  const skippedTicketIds: number[] = [];

  const selectNewCandidates = (candidates: readonly TCandidate[]): TCandidate[] => {
    const selected: TCandidate[] = [];

    candidates.forEach((candidate) => {
      if (seenTicketIds.has(candidate.id)) return;
      seenTicketIds.add(candidate.id);
      candidatesById.set(candidate.id, candidate);

      if (tryClaimTicket && !tryClaimTicket(candidate.id)) {
        skippedTicketIds.push(candidate.id);
        return;
      }

      attemptedTicketIds.push(candidate.id);
      selected.push(candidate);
    });

    return selected;
  };

  // Start a bounded local close queue before loading the snapshot so existing
  // visible tickets begin closing immediately. The snapshot read can discover
  // a position that was not yet rendered, but its closes wait for this queue:
  // one Close All action must never create two concurrent bursts for an
  // account and exceed the gateway's per-account admission limit.
  const selectedLocalCandidates = selectNewCandidates(localCandidates);
  const localClosePromise = closePositionsConcurrently(selectedLocalCandidates, closeCurrentPosition);
  if (selectedLocalCandidates.length > 0) onCandidatesStarted?.(selectedLocalCandidates);

  let authoritativeCandidates: readonly TCandidate[] = [];
  let authoritativeSnapshotError: unknown | null = null;
  try {
    authoritativeCandidates = await loadAuthoritativeCandidates();
  } catch (error) {
    authoritativeSnapshotError = error;
  }

  const localResult = await localClosePromise;

  let authoritativeResult: ClosePositionsConcurrentlyResult = EMPTY_CLOSE_RESULT;
  if (authoritativeSnapshotError === null && isSessionCurrent()) {
    const selectedAuthoritativeCandidates = selectNewCandidates(authoritativeCandidates);
    if (selectedAuthoritativeCandidates.length > 0) onCandidatesStarted?.(selectedAuthoritativeCandidates);
    authoritativeResult = await closePositionsConcurrently(selectedAuthoritativeCandidates, closeCurrentPosition);
  }
  const closeResult = mergeCloseResults(localResult, authoritativeResult);

  return {
    ...closeResult,
    attemptedTicketIds,
    skippedTicketIds,
    authoritativeSnapshotError,
    sessionCurrent: isSessionCurrent(),
  };
};

export type LocalFirstCloseCoordinator = {
  run: <TCandidate extends LocalFirstCloseCandidate>(
    options: LocalFirstCloseOptions<TCandidate>,
  ) => Promise<LocalFirstCloseResult>;
  hasInFlight: (sessionKey?: string) => boolean;
};

export const createLocalFirstCloseCoordinator = (): LocalFirstCloseCoordinator => {
  const inFlightBySession = new Map<string, Promise<LocalFirstCloseResult>>();

  return {
    run: <TCandidate extends LocalFirstCloseCandidate>(
      options: LocalFirstCloseOptions<TCandidate>,
    ): Promise<LocalFirstCloseResult> => {
      const existing = inFlightBySession.get(options.sessionKey);
      if (existing) return existing;

      const operation = closePositionsLocalFirst(options);
      const trackedOperation = operation.finally(() => {
        if (inFlightBySession.get(options.sessionKey) === trackedOperation) {
          inFlightBySession.delete(options.sessionKey);
        }
      });
      inFlightBySession.set(options.sessionKey, trackedOperation);
      return trackedOperation;
    },
    hasInFlight: (sessionKey?: string): boolean => (
      sessionKey === undefined
        ? inFlightBySession.size > 0
        : inFlightBySession.has(sessionKey)
    ),
  };
};
