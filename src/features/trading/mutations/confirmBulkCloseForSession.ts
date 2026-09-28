export type BulkCloseSessionConfirmationOptions = {
  sessionScope: string;
  getCurrentSessionScope: () => string;
  subscribeToSessionChange: (listener: () => void) => () => void;
  showConfirmation: () => Promise<boolean>;
  cancelConfirmation: () => void;
};

/**
 * Keeps the confirmation preview and the resulting mutation bound to the same
 * committed broker/account session. A session change actively cancels the
 * pending dialog instead of leaving its promise unresolved.
 */
export const confirmBulkCloseForSession = async ({
  sessionScope,
  getCurrentSessionScope,
  subscribeToSessionChange,
  showConfirmation,
  cancelConfirmation,
}: BulkCloseSessionConfirmationOptions): Promise<boolean> => {
  let sessionChanged = getCurrentSessionScope() !== sessionScope;
  const unsubscribe = subscribeToSessionChange(() => {
    if (getCurrentSessionScope() === sessionScope) return;
    sessionChanged = true;
    cancelConfirmation();
  });

  try {
    // Close the small read/subscribe race: a scope can change after the first
    // read but before the listener is attached.
    if (getCurrentSessionScope() !== sessionScope) sessionChanged = true;
    if (sessionChanged) return false;
    const confirmed = await showConfirmation();
    return Boolean(
      confirmed
      && !sessionChanged
      && getCurrentSessionScope() === sessionScope
    );
  } finally {
    unsubscribe();
  }
};
