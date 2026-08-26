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
  closePosition: (ticketId: number) => Promise<unknown>;
  tryClaimTicket?: (ticketId: number) => boolean;
  onCandidatesStarted?: (candidates: readonly TCandidate[]) => void;
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
    closePosition,
    tryClaimTicket,
    onCandidatesStarted,
  } = options;

  const isSessionCurrent = () => getCurrentSessionKey() === sessionKey;
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
  const attemptedTicketIds: number[] = [];
  const skippedTicketIds: number[] = [];

  const selectNewCandidates = (candidates: readonly TCandidate[]): TCandidate[] => {
    const selected: TCandidate[] = [];

    candidates.forEach((candidate) => {
      if (seenTicketIds.has(candidate.id)) return;
      seenTicketIds.add(candidate.id);

      if (tryClaimTicket && !tryClaimTicket(candidate.id)) {
        skippedTicketIds.push(candidate.id);
        return;
      }

      attemptedTicketIds.push(candidate.id);
      selected.push(candidate);
    });

    return selected;
  };

  // Construct this promise before invoking the snapshot loader. The concurrent
  // helper calls every local close synchronously before its first await.
  const selectedLocalCandidates = selectNewCandidates(localCandidates);
  const localClosePromise = closePositionsConcurrently(selectedLocalCandidates, closePosition);
  if (selectedLocalCandidates.length > 0) onCandidatesStarted?.(selectedLocalCandidates);

  let authoritativeCandidates: readonly TCandidate[] = [];
  let authoritativeSnapshotError: unknown | null = null;
  try {
    authoritativeCandidates = await loadAuthoritativeCandidates();
  } catch (error) {
    authoritativeSnapshotError = error;
  }

  let authoritativeClosePromise: Promise<ClosePositionsConcurrentlyResult> = Promise.resolve(EMPTY_CLOSE_RESULT);
  if (authoritativeSnapshotError === null && isSessionCurrent()) {
    const selectedAuthoritativeCandidates = selectNewCandidates(authoritativeCandidates);
    authoritativeClosePromise = closePositionsConcurrently(selectedAuthoritativeCandidates, closePosition);
    if (selectedAuthoritativeCandidates.length > 0) onCandidatesStarted?.(selectedAuthoritativeCandidates);
  }

  const [localResult, authoritativeResult] = await Promise.all([
    localClosePromise,
    authoritativeClosePromise,
  ]);
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
