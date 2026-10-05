import { useCallback, useEffect, useRef, useState } from 'react';
import { forgetSavedLogin, loadSavedLogin, saveLogin, savedLoginScopeKey, supportsSavedLogins, type SavedLoginScope } from '../services/savedLogins';

export function useSavedLogin(open: boolean, initialLogin: string, scope: SavedLoginScope | null) {
  const [login, updateLogin] = useState(initialLogin);
  const [password, updatePassword] = useState('');
  const [savePassword, updateSavePassword] = useState(false);
  const [completedRestore, setCompletedRestore] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const available = supportsSavedLogins();
  const edits = useRef(0);
  const restored = useRef(false);
  const previousScope = useRef('');
  const scopeKey = scope?.serverUrl ? savedLoginScopeKey(scope) : '';
  const [previousInput, setPreviousInput] = useState({ open, initialLogin, scopeKey });
  const resetLogin = previousInput.open !== open || previousInput.initialLogin !== initialLogin;
  const resetScope = previousInput.scopeKey !== scopeKey;
  if (resetLogin || resetScope) {
    // Reset before children commit so another account/broker never sees the
    // previous scope's password, even while its asynchronous restore is pending.
    setPreviousInput({ open, initialLogin, scopeKey });
    if (resetLogin) updateLogin(initialLogin);
    if (resetLogin || previousInput.scopeKey) {
      updatePassword('');
      updateSavePassword(false);
      setStorageError(null);
    }
    setCompletedRestore(null);
  }
  const restoreKey = JSON.stringify([open, initialLogin, scopeKey, login, available]);
  const restoring = open && Boolean(scopeKey) && available && completedRestore !== restoreKey;

  useEffect(() => {
    edits.current += 1;
    restored.current = false;
  }, [open, initialLogin]);

  useEffect(() => {
    let cancelled = false;
    if (previousScope.current && previousScope.current !== scopeKey) {
      edits.current += 1;
      restored.current = false;
    }
    previousScope.current = scopeKey;
    if (!open || !scopeKey || !available) return;
    const version = edits.current;
    const [brokerId, serverUrl] = JSON.parse(scopeKey) as [string, string];
    void loadSavedLogin({ brokerId, serverUrl }, login).then(saved => {
      if (cancelled || edits.current !== version || !saved) return;
      updateLogin(saved.login);
      updatePassword(saved.password);
      updateSavePassword(true);
      restored.current = true;
    }).catch(() => {
      if (!cancelled && edits.current === version) setStorageError('Unable to restore the saved password. Enter it again.');
    }).finally(() => { if (!cancelled) setCompletedRestore(restoreKey); });
    return () => { cancelled = true; };
  }, [open, scopeKey, login, available, restoreKey]);

  const setLogin = useCallback((value: string) => {
    edits.current += 1;
    if (restored.current) updatePassword('');
    restored.current = false;
    updateSavePassword(false);
    updateLogin(value);
    setStorageError(null);
  }, []);
  const setPassword = useCallback((value: string) => {
    edits.current += 1;
    restored.current = false;
    updatePassword(value);
    setStorageError(null);
  }, []);
  const setSavePassword = (value: boolean) => {
    edits.current += 1;
    const version = edits.current;
    updateSavePassword(value);
    setStorageError(null);
    if (!value && scope) void forgetSavedLogin(scope, login).catch(() => {
      if (edits.current === version) setStorageError('Unable to remove the saved password. Try again.');
    });
  };
  const persistPassword = async (submitScope: SavedLoginScope, account: string, secret: string) => {
    if (!available) return;
    if (savePassword) await saveLogin(submitScope, account, secret);
    else if (restored.current) await forgetSavedLogin(submitScope, account);
  };
  return { login, password, setLogin, setPassword, savePassword, setSavePassword, available, restoring, storageError, persistPassword };
}
