export interface ChartInteractionPointerStart {
  pointerId: number;
  button: number;
  isPrimary: boolean;
}

export interface ChartInteractionOwnershipOptions {
  idleMs: number;
  onActive: () => void;
  onIdle: () => void;
}

export interface ChartInteractionOwnership {
  beginPointer: (event: ChartInteractionPointerStart) => boolean;
  releasePointer: (pointerId: number) => boolean;
  setTouchFallbackHeld: (held: boolean) => void;
  notePointerLeave: () => void;
  noteRangeActivity: () => void;
  noteWheelActivity: () => void;
  isActive: () => boolean;
  isHeld: () => boolean;
  forceSettle: () => boolean;
  reset: () => void;
  dispose: () => void;
}

/**
 * Owns the distinction between a held pointer and post-release kinetic motion.
 * A timer may settle kinetic motion, but it must never end a pointer that is
 * still physically held, even when pointer events arrive more than idleMs apart.
 */
export const createChartInteractionOwnership = ({
  idleMs,
  onActive,
  onIdle,
}: ChartInteractionOwnershipOptions): ChartInteractionOwnership => {
  let active = false;
  let heldPointerId: number | null = null;
  let touchFallbackHeld = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const isHeld = () => heldPointerId !== null || touchFallbackHeld;

  const cancelIdle = () => {
    if (idleTimer === null) return;
    clearTimeout(idleTimer);
    idleTimer = null;
  };

  const activate = () => {
    if (disposed) return;
    cancelIdle();
    if (active) return;
    active = true;
    onActive();
  };

  const scheduleIdle = () => {
    cancelIdle();
    if (disposed || !active || isHeld()) return;

    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (disposed || !active || isHeld()) return;
      active = false;
      onIdle();
    }, idleMs);
  };

  return {
    beginPointer: ({ pointerId, button, isPrimary }) => {
      if (disposed || !isPrimary || button !== 0) return false;
      if (heldPointerId !== null && heldPointerId !== pointerId) return false;
      heldPointerId = pointerId;
      activate();
      return true;
    },
    releasePointer: (pointerId) => {
      if (heldPointerId !== pointerId) return false;
      heldPointerId = null;
      scheduleIdle();
      return true;
    },
    setTouchFallbackHeld: (held) => {
      if (disposed || held === touchFallbackHeld) return;
      touchFallbackHeld = held;
      if (held) {
        activate();
      } else {
        scheduleIdle();
      }
    },
    // Leaving the chart surface is not a release. Window-level pointerup or
    // pointercancel owns the end of a held gesture.
    notePointerLeave: () => undefined,
    noteRangeActivity: () => {
      if (!active || isHeld()) return;
      scheduleIdle();
    },
    noteWheelActivity: () => {
      activate();
      scheduleIdle();
    },
    isActive: () => active,
    isHeld,
    forceSettle: () => {
      cancelIdle();
      heldPointerId = null;
      touchFallbackHeld = false;
      if (disposed || !active) return false;
      active = false;
      onIdle();
      return true;
    },
    reset: () => {
      cancelIdle();
      active = false;
      heldPointerId = null;
      touchFallbackHeld = false;
    },
    dispose: () => {
      disposed = true;
      cancelIdle();
      active = false;
      heldPointerId = null;
      touchFallbackHeld = false;
    },
  };
};
