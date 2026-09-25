// State events are invalidations, never partial account/position snapshots.
// A fixed window bounds request rate without postponing refresh indefinitely
// when another terminal continuously changes orders.
export function createStateInvalidator(refresh: (login: number) => void, delay = 50) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingLogin: number | undefined;
  return {
    invalidate(login: number) {
      if (!Number.isSafeInteger(login) || login <= 0) return;
      pendingLogin = login;
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        const target = pendingLogin;
        pendingLogin = undefined;
        if (target !== undefined) refresh(target);
      }, delay);
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pendingLogin = undefined;
    },
  };
}
