type LoginTransportRuntime = typeof import('./loginTransportRuntime');
type LoginStoreRuntime = typeof import('../store/useAppStore');

let loginTransportRuntimePromise: Promise<LoginTransportRuntime> | null = null;
let loginStoreRuntimePromise: Promise<LoginStoreRuntime> | null = null;

/** Reuse one transport import for idle warmup and the eventual submit. */
export const preloadLoginTransportRuntime = (): Promise<LoginTransportRuntime> => {
  if (!loginTransportRuntimePromise) {
    loginTransportRuntimePromise = import('./loginTransportRuntime').catch((error) => {
      loginTransportRuntimePromise = null;
      throw error;
    });
  }

  return loginTransportRuntimePromise;
};

/**
 * This loader must only be called after authentication returned a valid token.
 * It intentionally has no eager warmup path.
 */
export const loadAuthenticatedLoginStoreRuntime = (): Promise<LoginStoreRuntime> => {
  if (!loginStoreRuntimePromise) {
    loginStoreRuntimePromise = import('../store/useAppStore').catch((error) => {
      loginStoreRuntimePromise = null;
      throw error;
    });
  }

  return loginStoreRuntimePromise;
};
