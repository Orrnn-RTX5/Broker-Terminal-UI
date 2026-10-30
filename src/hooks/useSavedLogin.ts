import { useCallback, useEffect, useRef, useState } from 'react';
import { forgetSavedLogin, loadSavedLogin, saveLogin, savedLoginScopeKey, supportsSavedLogins, type SavedLoginScope } from '../services/savedLogins';
import { getCachedAccountSession } from '../services/accountSessionCache';

export function useSavedLogin(open: boolean, initialLogin: string, scope: SavedLoginScope | null) {
  const [login, updateLogin] = useState(initialLogin);
  const [password, updatePassword] = useState('');
  const [savePassword, updateSavePassword] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const available = supportsSavedLogins();
  const edits = useRef(0);
  const restored = useRef(false);
  const previousScope = useRef('');
  const scopeKey = scope?.serverUrl ? savedLoginScopeKey(scope) : '';

  useEffect(() => {
    edits.current += 1;
    updateLogin(initialLogin);
    updatePassword('');
    updateSavePassword(false);
    setStorageError(null);
    restored.current = false;
  }, [open, initialLogin]);

  useEffect(() => {
    let cancelled = false;
    if (previousScope.current && previousScope.current.toLowerCase() !== scopeKey.toLowerCase()) {
      edits.current += 1;
      updatePassword('');
      updateSavePassword(false);
      restored.current = false;
    }
    previousScope.current = scopeKey;
    if (!open || !scopeKey || !available) { setRestoring(false); return; }
    const version = edits.current;
    setRestoring(true);
    const [brokerId, serverUrl] = JSON.parse(scopeKey) as [string, string];
    void loadSavedLogin({ brokerId, serverUrl }, login).then(saved => {
      if (cancelled || edits.current !== version) return;
      if (saved) {
        updateLogin(saved.login);
        updatePassword(saved.password);
        updateSavePassword(true);
        restored.current = true;
        return;
      }
      const trimmedLogin = login.trim();
      if (trimmedLogin) {
        const cached = getCachedAccountSession({ brokerId, serverUrl, login: trimmedLogin });
        if (cached?.password) {
          updatePassword(cached.password);
          restored.current = true;
        }
      }
    }).catch(() => {
      if (!cancelled && edits.current === version) setStorageError('Unable to restore the saved password. Enter it again.');
    }).finally(() => { if (!cancelled) setRestoring(false); });
    return () => { cancelled = true; };
  }, [open, scopeKey, login, available]);

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
