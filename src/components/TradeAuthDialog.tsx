import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LogIn, ShieldCheck, UserPlus, X } from 'lucide-react';
import { LoginDialog } from './LoginDialog';
import { registerRuntimeBrokerDemoAccount } from '../api/demoRegistration';
import { parseTokenExpiresAt, setRefreshToken, setToken } from '../api/client';
import { useAppStore } from '../store/useAppStore';
import type { TradingAuthIntent } from '../services/tradingAuthGate';
import { useBrokerLoginPolicy } from '../hooks/useBrokerLoginPolicy';

interface TradeAuthDialogProps {
  isOpen: boolean;
  intent: TradingAuthIntent | null;
  onClose: () => void;
  onAuthenticated: (accountId: string) => void;
}

type DialogMode = 'choice' | 'login' | 'demo';

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unable to create the demo account.';
const normalizeBrokerId = (value: unknown): string => String(value ?? '').trim().toLowerCase();

export function TradeAuthDialog({ isOpen, intent, onClose, onAuthenticated }: TradeAuthDialogProps) {
  const [mode, setMode] = useState<DialogMode>('choice');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const demoRequestGenerationRef = useRef(0);
  const brokerPolicy = useBrokerLoginPolicy(isOpen);
  const brokerId = brokerPolicy?.status === 'ready' ? brokerPolicy.brokerId : '';

  useEffect(() => {
    if (!isOpen) return;
    setMode('choice');
    setError(null);
    setPassword('');
    setConfirmPassword('');
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) demoRequestGenerationRef.current += 1;
    return () => {
      demoRequestGenerationRef.current += 1;
    };
  }, [isOpen]);

  const closeDialog = useCallback(() => {
    demoRequestGenerationRef.current += 1;
    setSubmitting(false);
    onClose();
  }, [onClose]);

  const leaveDemo = useCallback(() => {
    demoRequestGenerationRef.current += 1;
    setSubmitting(false);
    setMode('choice');
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (mode === 'choice') closeDialog();
      else leaveDemo();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeDialog, isOpen, leaveDemo, mode]);

  const completeDemoSession = (response: Awaited<ReturnType<typeof registerRuntimeBrokerDemoAccount>>) => {
    if (!brokerId) throw new Error('This terminal does not have a broker configured.');
    if (response.broker_id && normalizeBrokerId(response.broker_id) !== normalizeBrokerId(brokerId)) {
      throw new Error('The demo account was returned for a different broker.');
    }
    const token = response.access_token || response.token;
    const accountId = String(response.account_login ?? response.login ?? '');
    if (!token || !accountId) throw new Error('The demo session response is incomplete.');

    const expiresAt = parseTokenExpiresAt(response.expires_at)
      || (response.expires_in ? Date.now() + response.expires_in * 1000 : undefined);

    setToken(token);
    if (response.refresh_token) {
      setRefreshToken(response.refresh_token);
    } else {
      localStorage.removeItem('refresh_token');
      sessionStorage.removeItem('refresh_token');
    }
    if (expiresAt) {
      localStorage.setItem('token_expires_at', new Date(expiresAt).toISOString());
    } else {
      localStorage.removeItem('token_expires_at');
      sessionStorage.removeItem('token_expires_at');
    }
    localStorage.setItem('rtx_last_login', accountId);
    localStorage.setItem('rtx_saved_username', accountId);
    localStorage.removeItem('rtx_saved_password');

    const login = Number.parseInt(accountId, 10);
    const store = useAppStore.getState();
    store.setAuthTokens(token, response.refresh_token, expiresAt);
    store.setAuthenticated(true, accountId, token, response.refresh_token, expiresAt);
    if (Number.isFinite(login) && login > 0) {
      store.addSavedAccount({
        login,
        name: response.name || response.username || name.trim(),
        server: response.broker_name || response.server || response.broker_id || brokerId,
        isLive: false,
        lastUsed: Date.now(),
      });
      store.setActiveAccount(login);
    }

    onAuthenticated(accountId);
  };

  const handleDemoSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!name.trim() || !email.trim() || !password) {
      setError('Name, email, and password are required.');
      return;
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setError('Password must be at least 8 characters and include a letter and a number.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    const requestGeneration = ++demoRequestGenerationRef.current;
    try {
      const response = await registerRuntimeBrokerDemoAccount({ name, email, password }, brokerId);
      if (requestGeneration !== demoRequestGenerationRef.current) return;
      completeDemoSession(response);
    } catch (registrationError) {
      if (requestGeneration !== demoRequestGenerationRef.current) return;
      setError(getErrorMessage(registrationError));
    } finally {
      if (requestGeneration === demoRequestGenerationRef.current) setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  if (mode === 'login') {
    return (
      <LoginDialog
        isOpen
        onClose={() => setMode('choice')}
        onLoginSuccess={onAuthenticated}
        initialServer={brokerId}
        lockedBrokerId={brokerId}
        lockedBrokerDisplayName={brokerPolicy?.displayName}
      />
    );
  }

  const isMutationIntent = intent?.kind === 'mutation';
  const intentLabel = isMutationIntent
    ? intent.actionLabel
    : intent
      ? `${intent.side} ${intent.volume} ${intent.symbol}`
      : 'your trade';

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center px-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/70"
        aria-label="Close authentication dialog"
        onClick={closeDialog}
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-auth-title"
        className="relative w-full max-w-[460px] overflow-hidden rounded-xl border border-[#454a59] bg-[#20232d] text-zinc-200 shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-[#3a3e4a] bg-[#292d39] px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-emerald-400" />
            <h2 id="trade-auth-title" className="text-sm font-semibold">
              {mode === 'demo' ? 'Create demo account' : 'Login required to trade'}
            </h2>
          </div>
          <button type="button" onClick={closeDialog} className="rounded p-1 hover:bg-white/10" aria-label="Close">
            <X size={16} />
          </button>
        </header>

        {mode === 'choice' ? (
          <div className="space-y-4 p-5">
            <p className="text-sm leading-6 text-zinc-300">
              Charts and market data stay available in guest mode. To continue with
              <span className="mx-1 font-semibold text-white">{intentLabel}</span>
              choose an account option below.
            </p>
            <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-100/80">
              {isMutationIntent
                ? 'This action will not run after login. Review the freshly loaded account data, then choose the action again.'
                : 'Your order will not be sent after login. The order ticket will reopen so you can review and confirm it.'}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMode('login')}
                disabled={!brokerId}
                className="flex min-h-24 flex-col items-start gap-2 rounded-lg border border-blue-400/30 bg-blue-500/10 p-4 text-left hover:bg-blue-500/20"
              >
                <LogIn size={20} className="text-blue-400" />
                <span className="font-semibold text-white">Login real account</span>
                <span className="text-xs text-zinc-400">Use an existing valid trading login.</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('demo')}
                disabled={!brokerId}
                className="flex min-h-24 flex-col items-start gap-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-4 text-left hover:bg-emerald-500/20"
              >
                <UserPlus size={20} className="text-emerald-400" />
                <span className="font-semibold text-white">Create demo account</span>
                <span className="text-xs text-zinc-400">Open a virtual-money account for this broker.</span>
              </button>
            </div>
            {!brokerId && (
              <div role="alert" className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {brokerPolicy?.error || 'Verifying this terminal broker configuration...'}
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleDemoSubmit} className="space-y-3 p-5">
            <div className="rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-xs text-zinc-400">
              Broker: <span className="font-mono text-zinc-200">{brokerPolicy?.displayName || 'Not configured'}</span>
            </div>
            <label className="block text-xs text-zinc-400">
              Full name
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                className="mt-1 w-full rounded-md border border-[#4b5060] bg-[#15171e] px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
              />
            </label>
            <label className="block text-xs text-zinc-400">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                className="mt-1 w-full rounded-md border border-[#4b5060] bg-[#15171e] px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
              />
            </label>
            <label className="block text-xs text-zinc-400">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full rounded-md border border-[#4b5060] bg-[#15171e] px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
              />
            </label>
            <label className="block text-xs text-zinc-400">
              Confirm password
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full rounded-md border border-[#4b5060] bg-[#15171e] px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
              />
            </label>
            {error && (
              <div role="alert" className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={leaveDemo} className="rounded-md px-4 py-2 text-sm hover:bg-white/10">
                Back
              </button>
              <button
                type="submit"
                disabled={submitting || !brokerId}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Creating...' : 'Create and continue'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>,
    document.body,
  );
}
