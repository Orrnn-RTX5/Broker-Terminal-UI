export interface ChartPostInteractionWork {
  history?: boolean;
  model?: boolean;
  live?: boolean;
  separators?: boolean;
  overlay?: boolean;
}

export interface ChartPostInteractionCallbacks {
  consumeHistory: () => void;
  prepareLiveModel: () => void;
  paintModel: () => boolean;
  paintLive: (fullModelPainted: boolean) => void;
  paintSeparators: () => void;
  layoutOverlay: () => void;
}

export interface ChartPostInteractionCoordinator {
  request: (work: ChartPostInteractionWork) => void;
  flush: () => boolean;
  clear: () => void;
  hasPending: () => boolean;
}

const enum ChartPostInteractionPhase {
  History,
  LivePrepare,
  Model,
  LiveFinalize,
  Separators,
  Overlay,
}

const PHASE_ORDER: readonly ChartPostInteractionPhase[] = [
  ChartPostInteractionPhase.History,
  ChartPostInteractionPhase.LivePrepare,
  ChartPostInteractionPhase.Model,
  ChartPostInteractionPhase.LiveFinalize,
  ChartPostInteractionPhase.Separators,
  ChartPostInteractionPhase.Overlay,
];

const getRequestedPhases = (work: ChartPostInteractionWork): ChartPostInteractionPhase[] => {
  const phases: ChartPostInteractionPhase[] = [];
  if (work.history) phases.push(ChartPostInteractionPhase.History);
  if (work.live) phases.push(ChartPostInteractionPhase.LivePrepare);
  if (work.model || work.live) phases.push(ChartPostInteractionPhase.Model);
  if (work.live) phases.push(ChartPostInteractionPhase.LiveFinalize);
  if (work.separators) phases.push(ChartPostInteractionPhase.Separators);
  if (work.overlay) phases.push(ChartPostInteractionPhase.Overlay);
  return phases;
};

/** Executes one ordered gesture-settle pass and absorbs decoration requests
 * raised synchronously by a full model paint into that same pass. */
export const createChartPostInteractionCoordinator = (
  callbacks: ChartPostInteractionCallbacks,
): ChartPostInteractionCoordinator => {
  const pendingPhases = new Set<ChartPostInteractionPhase>();
  let currentPassPhases: Set<ChartPostInteractionPhase> | null = null;
  let activePhase: ChartPostInteractionPhase | null = null;
  let flushing = false;

  const request = (work: ChartPostInteractionWork) => {
    for (const phase of getRequestedPhases(work)) {
      if (flushing && currentPassPhases && activePhase !== null) {
        // Re-entrant requests for a phase already reached by this pass have
        // observed the latest refs and are absorbed. Only later phases join
        // the current pass, where each phase still executes at most once.
        if (phase > activePhase) currentPassPhases.add(phase);
      } else {
        pendingPhases.add(phase);
      }
    }
  };

  return {
    request,
    flush: () => {
      if (flushing || pendingPhases.size === 0) return false;
      flushing = true;
      currentPassPhases = new Set(pendingPhases);
      pendingPhases.clear();
      let fullModelPainted = false;

      try {
        for (const phase of PHASE_ORDER) {
          if (!currentPassPhases.has(phase)) continue;
          activePhase = phase;

          switch (phase) {
            case ChartPostInteractionPhase.History:
              callbacks.consumeHistory();
              break;
            case ChartPostInteractionPhase.LivePrepare:
              callbacks.prepareLiveModel();
              break;
            case ChartPostInteractionPhase.Model:
              fullModelPainted = callbacks.paintModel();
              if (fullModelPainted) {
                request({ separators: true, overlay: true });
              }
              break;
            case ChartPostInteractionPhase.LiveFinalize:
              callbacks.paintLive(fullModelPainted);
              break;
            case ChartPostInteractionPhase.Separators:
              callbacks.paintSeparators();
              break;
            case ChartPostInteractionPhase.Overlay:
              callbacks.layoutOverlay();
              break;
          }
        }
        return true;
      } finally {
        currentPassPhases = null;
        activePhase = null;
        flushing = false;
      }
    },
    clear: () => {
      pendingPhases.clear();
      currentPassPhases?.clear();
    },
    hasPending: () => pendingPhases.size > 0,
  };
};
