import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, ChevronRight, Info, LogIn, ShieldCheck, UserPlus, X } from 'lucide-react';
import '../styles/trade-auth-dialog.css';
import { LoginDialog } from './LoginDialog';
import { registerRuntimeBrokerDemoAccount } from '../api/demoRegistration';
import { parseTokenExpiresAt, setRefreshToken, setToken } from '../api/client';
import { useAppStore } from '../store/useAppStore';
import type { TradingAuthIntent } from '../services/tradingAuthGate';
import { useBrokerLoginPolicy } from '../hooks/useBrokerLoginPolicy';
import { isElectronRuntime } from '../config/backendTarget.js';

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

export function TradeAuthDialog(props: TradeAuthDialogProps) {
  // Desktop accounts belong to the selected directory server, not a web
  // deployment. Keep the broker selector available when re-authenticating.
  if (isElectronRuntime()) {
    return (
      <LoginDialog
        isOpen={props.isOpen}
        reason="trade"
        onClose={props.onClose}
        onLoginSuccess={props.onAuthenticated}
      />
    );
  }

  return <WebTradeAuthDialog {...props} />;
}

function WebTradeAuthDialog({ isOpen, intent, onClose, onAuthenticated }: TradeAuthDialogProps) {
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
  const isDemo = mode === 'demo';

  return createPortal(
    <div className="rtx-auth-backdrop">
      <button
        type="button"
        className="rtx-auth-backdrop__dismiss"
        aria-label="Close authentication dialog"
        tabIndex={-1}
        onClick={closeDialog}
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-auth-title"
        aria-describedby="trade-auth-description"
        className="rtx-auth-dialog"
        data-mode={mode}
      >
        <header className="rtx-auth-dialog__header">
          <div className="rtx-auth-dialog__heading">
            <span className="rtx-auth-dialog__header-icon" aria-hidden="true">
              {isDemo ? <UserPlus size={19} strokeWidth={1.8} /> : <ShieldCheck size={19} strokeWidth={1.8} />}
            </span>
            <div className="rtx-auth-dialog__heading-copy">
              <h2 id="trade-auth-title" className="rtx-auth-dialog__title">
                {isDemo ? 'Create demo account' : 'Account required to trade'}
              </h2>
              <p id="trade-auth-description" className="rtx-auth-dialog__subtitle">
                {isDemo
                  ? 'Set up a practice account with virtual funds.'
                  : 'Choose an account to continue securely.'}
              </p>
            </div>
          </div>
          <button type="button" onClick={closeDialog} className="rtx-auth-dialog__close" aria-label="Close">
            <X size={16} />
          </button>
        </header>

        {mode === 'choice' ? (
          <>
            <div className="rtx-auth-dialog__body">
              {intent && (
                <div className="rtx-auth-order-card">
                  <div className="rtx-auth-order-info">
                    <div className="rtx-auth-order-lead">
                      {isMutationIntent ? (
                        <span className="rtx-auth-badge rtx-auth-badge--action">Action</span>
                      ) : (
                        <span className={`rtx-auth-badge rtx-auth-badge--${intent.side.toLowerCase()}`}>
                          {intent.side}
                        </span>
                      )}
                      <span className="rtx-auth-order-symbol">
                        {isMutationIntent ? intent.actionLabel : intent.symbol}
                      </span>
                      {!isMutationIntent && intent.volume && (
                        <>
                          <span className="rtx-auth-order-dot" aria-hidden="true">·</span>
                          <span className="rtx-auth-order-volume">{intent.volume} lots</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="rtx-auth-order-note">
                    <Info size={13} className="rtx-auth-order-note-icon" aria-hidden="true" />
                    <span className="rtx-auth-order-note-text">
                      {isMutationIntent
                        ? 'This action will not run automatically after login. Review your account data, then choose it again.'
                        : 'This order will not be sent automatically. The ticket reopens after login so you can confirm it.'}
                    </span>
                  </div>
                </div>
              )}

              <div className="rtx-auth-actions">
                <button
                  type="button"
                  className="rtx-auth-action rtx-auth-action--primary"
                  onClick={() => setMode('login')}
                  disabled={!brokerId}
                >
                  <span className="rtx-auth-action__icon" aria-hidden="true">
                    <LogIn size={17} strokeWidth={1.9} />
                  </span>
                  <span className="rtx-auth-action__copy">
                    <span className="rtx-auth-action__label">Login to real account</span>
                    <span className="rtx-auth-action__description">Use your existing live trading account</span>
                  </span>
                  <ChevronRight className="rtx-auth-action__chevron" size={16} strokeWidth={1.8} aria-hidden="true" />
                </button>

                <button
                  type="button"
                  className="rtx-auth-action rtx-auth-action--secondary"
                  onClick={() => setMode('demo')}
                  disabled={!brokerId}
                >
                  <span className="rtx-auth-action__icon" aria-hidden="true">
                    <UserPlus size={17} strokeWidth={1.9} />
                  </span>
                  <span className="rtx-auth-action__copy">
                    <span className="rtx-auth-action__label">Create demo account</span>
                    <span className="rtx-auth-action__description">Practice risk-free with virtual funds</span>
                  </span>
                  <ChevronRight className="rtx-auth-action__chevron" size={16} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </div>

              {!brokerId && (
                <div role="alert" className="rtx-auth-alert">
                  <AlertCircle size={13} strokeWidth={2.2} />
                  <span>{brokerPolicy?.error || 'Verifying this terminal broker configuration…'}</span>
                </div>
              )}
            </div>

            <div className="rtx-auth-dialog__footer rtx-auth-dialog__footer--choice">
              <button
                type="button"
                onClick={closeDialog}
                className="rtx-auth-guest-link"
              >
                <span>Continue browsing in guest mode</span>
                <ChevronRight size={14} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleDemoSubmit}>
            <div className="rtx-auth-dialog__body">
              <div className="rtx-auth-broker">
                <span className="rtx-auth-broker__label">Broker</span>
                <span className="rtx-auth-broker__value">
                  {brokerPolicy?.displayName || 'Not configured'}
                </span>
              </div>

              <div className="rtx-auth-form">
                <label className="rtx-auth-field">
                  <span className="rtx-auth-field__label">Full name</span>
                  <input
                    autoFocus
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    placeholder="Your name"
                  />
                </label>

                <label className="rtx-auth-field">
                  <span className="rtx-auth-field__label">Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    placeholder="you@example.com"
                  />
                </label>

                <div className="rtx-auth-grid">
                  <label className="rtx-auth-field">
                    <span className="rtx-auth-field__label">Password</span>
                    <input
                      type="text"
                      className="rtx-secret-input"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="none"
                      placeholder="••••••••"
                    />
                  </label>

                  <label className="rtx-auth-field">
                    <span className="rtx-auth-field__label">Confirm password</span>
                    <input
                      type="text"
                      className="rtx-secret-input"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="none"
                      placeholder="••••••••"
                    />
                  </label>
                </div>

                <span className="rtx-auth-field__hint">
                  At least 8 characters, including one letter and one number.
                </span>
              </div>

              {error && (
                <div role="alert" className="rtx-auth-alert">
                  <AlertCircle size={13} strokeWidth={2.2} />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <div className="rtx-auth-dialog__footer">
              <button type="button" onClick={leaveDemo} className="rtx-auth-button" data-variant="ghost">
                Back
              </button>
              <button
                type="submit"
                disabled={submitting || !brokerId}
                className="rtx-auth-button"
                data-variant="primary"
              >
                {submitting && <span className="rtx-auth-spinner" aria-hidden="true" />}
                {submitting ? 'Creating…' : 'Create and continue'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>,
    document.body,
  );
}
