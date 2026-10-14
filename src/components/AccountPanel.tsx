import { useUiTranslation } from '../hooks/useUiTranslation';
/**
 * Account Management Panel
 * Comprehensive account management sidebar for traders
 */

import { Icon } from './ui/Icon';
import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { getStoredAccountLogin, tradeGatewayApi } from '../api/tradeGateway';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { openBottomDockTab } from '../services/bottomDockNavigation';

interface AccountPanelProps {
  onClose: () => void;
  wsConnection: WebSocket | null;
}

interface Transaction {
  id: string;
  date: string;
  type: 'deposit' | 'withdrawal';
  amount: number;
  status: 'pending' | 'completed' | 'failed';
  method?: string;
}

export const AccountPanel: React.FC<AccountPanelProps> = ({ onClose }) => {
  const tr = useUiTranslation();
  const { account, accountId, savedAccounts } = useAppStore();
  const oneClickTrading = useSettingsStore((state) => state.trade.oneClickTrading);
  const updateTradeSettings = useSettingsStore((state) => state.updateTradeSettings);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);
  const [leverage, setLeverage] = useState<number>(account?.leverage || 100);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);

  const activeLogin = Number.parseInt(accountId || '', 10) || getStoredAccountLogin() || 0;
  const savedAccountMeta = savedAccounts.find((item) => item.login === activeLogin);
  const resolvedAccountType = savedAccountMeta?.accountType === 'real' || savedAccountMeta?.isLive
    ? 'Live'
    : savedAccountMeta?.accountType === 'demo'
      ? 'Demo'
      : savedAccountMeta?.accountType === 'contest'
        ? 'Contest'
        : 'Standard';

  const [accountInfo, setAccountInfo] = useState({
    accountNumber: activeLogin ? `RTX-${activeLogin.toString().padStart(6, '0')}` : '—',
    accountType: resolvedAccountType,
    leverage: account?.leverage || 100,
  });

  // Fetch real account details
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const login = Number.parseInt(accountId || '', 10) || getStoredAccountLogin();
        if (!login) return;
        const data = await tradeGatewayApi.getAccount(login);
        setAccountInfo({
          accountNumber: `RTX-${login.toString().padStart(6, '0')}`,
          accountType: resolvedAccountType,
          leverage: data.leverage || 100,
        });
        setLeverage(data.leverage || 100);
      } catch (err) {
        console.error('Failed to fetch account profile:', err);
      }
    };
    fetchProfile();
  }, [accountId, resolvedAccountType]);

  // Fetch transaction history
  useEffect(() => {
    const fetchTransactions = async () => {
      setIsLoadingTransactions(true);
      try {
        const login = Number.parseInt(accountId || '', 10) || getStoredAccountLogin();
        if (!login) {
          setTransactions([]);
          return;
        }
        const data = await tradeGatewayApi.getBalanceHistory(login, 10);
        setTransactions((data || []).slice(0, 10).map((item: any) => ({
          id: String(item.id ?? item.time ?? Math.random()),
          date: item.time ? new Date(item.time * 1000).toISOString() : new Date().toISOString(),
          type: item.type === 'withdrawal' ? 'withdrawal' : 'deposit',
          amount: Number(item.amount ?? 0),
          status: 'completed',
          method: item.comment,
        })));
      } catch (error) {
        console.error('Failed to fetch transactions:', error);
        setTransactions([]);
      } finally {
        setIsLoadingTransactions(false);
      }
    };

    fetchTransactions();
  }, [accountId]);

  const handleViewAllHistory = () => {
    openBottomDockTab('History');
  };

  return (
    <>
      <aside
        className="rtx-account-panel w-80 h-full flex flex-col overflow-hidden select-none"
        style={{
          background: 'var(--bg-secondary, #131316)',
          borderLeft: '1px solid var(--border-primary, #28282e)',
          color: 'var(--text-primary, #e2e2e8)',
        }}
        aria-label={tr("Account Management")}
      >
        {/* Header */}
        <div
          className="rtx-account-panel__header flex min-h-[32px] items-center justify-between px-3.5 py-1.5"
          style={{
            background: 'var(--bg-tertiary, #191a1e)',
            borderBottom: '1px solid var(--border-primary, #28282e)',
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Icon name="credit-card" size="sm" className="w-4 h-4 shrink-0 text-blue-400" />
            <h2
              className="text-[14px] leading-[21px] font-normal truncate"
              style={{ color: 'var(--text-primary, #e2e2e8)' }}
            >
              {tr("Account Management")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr("Close")}
            title={tr("Close")}
            className="dock-panel__action dock-panel__action--close flex h-5 w-5 shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-red-500/80 hover:text-white"
            style={{ color: 'var(--text-secondary, #808088)' }}
          >
            <Icon name="x-close" size="sm" className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {/* Section 1: Account Summary */}
          <div
            className="p-3.5"
            style={{ borderBottom: '1px solid var(--border-primary, #28282e)' }}
          >
            <div className="flex items-center justify-between mb-2.5">
              <h3
                className="text-[12px] leading-[18px] font-normal uppercase tracking-wider"
                style={{ color: 'var(--text-tertiary, #808088)' }}
              >
                {tr("Account Summary")}
              </h3>
              <span
                className="text-[11px] font-medium px-2 py-0.5 rounded"
                style={{
                  background: 'var(--color-info-dim, rgba(59, 130, 246, 0.14))',
                  color: 'var(--color-info, #60a5fa)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                }}
              >
                {tr(accountInfo.accountType)}
              </span>
            </div>

            {/* Account Identity Card */}
            <div
              className="rtx-account-panel__card rounded-md p-3 mb-3 space-y-1.5"
              style={{
                background: 'var(--bg-tertiary, #191a1e)',
                border: '1px solid var(--border-primary, #28282e)',
              }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-[14px] leading-[21px] font-normal"
                  style={{ color: 'var(--text-secondary, #808088)' }}
                >
                  {tr("Account")}
                </span>
                <span
                  className="text-[14px] leading-[21px] font-mono tabular-nums font-normal"
                  style={{ color: 'var(--text-primary, #e2e2e8)' }}
                >
                  {accountInfo.accountNumber}
                </span>
              </div>
              {savedAccountMeta?.server && (
                <div className="flex items-center justify-between">
                  <span
                    className="text-[14px] leading-[21px] font-normal"
                    style={{ color: 'var(--text-secondary, #808088)' }}
                  >
                    {tr("Server")}
                  </span>
                  <span
                    className="text-[13px] leading-[19.5px] font-normal truncate max-w-[160px]"
                    style={{ color: 'var(--text-primary, #e2e2e8)' }}
                    title={savedAccountMeta.server}
                  >
                    {savedAccountMeta.server}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span
                  className="text-[14px] leading-[21px] font-normal"
                  style={{ color: 'var(--text-secondary, #808088)' }}
                >
                  {tr("Leverage")}
                </span>
                <span
                  className="text-[14px] leading-[21px] font-mono tabular-nums font-normal"
                  style={{ color: 'var(--text-primary, #e2e2e8)' }}
                >
                  1:{leverage}
                </span>
              </div>
            </div>

            {/* Balance & Margin Metrics */}
            <div className="space-y-1">
              <BalanceRow
                label={tr("Balance")}
                value={account?.balance || 0}
                currency={account?.currency || 'USD'}
              />
              <BalanceRow
                label={tr("Equity")}
                value={account?.equity || 0}
                currency={account?.currency || 'USD'}
                valueColor="text-emerald-400"
              />
              <BalanceRow
                label={tr("Margin")}
                value={account?.margin || 0}
                currency={account?.currency || 'USD'}
              />
              <BalanceRow
                label={tr("Free Margin")}
                value={account?.freeMargin || 0}
                currency={account?.currency || 'USD'}
              />
              <BalanceRow
                label={tr("Margin Level")}
                value={account?.marginLevel || 0}
                suffix="%"
                valueColor={getMarginLevelColor(account?.marginLevel || 0)}
              />
            </div>
          </div>

          {/* Section 2: Balance Operations / Ledger */}
          <div
            className="p-3.5"
            style={{ borderBottom: '1px solid var(--border-primary, #28282e)' }}
          >
            <div className="flex items-center justify-between mb-2.5">
              <h3
                className="text-[12px] leading-[18px] font-normal uppercase tracking-wider"
                style={{ color: 'var(--text-tertiary, #808088)' }}
              >
                {tr("Transaction History")}
              </h3>
              <button
                type="button"
                onClick={handleViewAllHistory}
                className="text-[12px] leading-[18px] font-normal transition-colors hover:underline"
                style={{ color: 'var(--color-info, #60a5fa)' }}
                title={tr("View All")}
              >
                {tr("View All")}
              </button>
            </div>

            {isLoadingTransactions ? (
              <div
                className="text-center py-5 text-[14px] leading-[21px] font-normal rounded-md"
                style={{
                  color: 'var(--text-tertiary, #808088)',
                  background: 'var(--bg-tertiary, #191a1e)',
                  border: '1px solid var(--border-primary, #28282e)',
                }}
              >
                {tr("Loading transactions...")}
              </div>
            ) : transactions.length === 0 ? (
              <div
                className="text-center py-5 px-3 text-[14px] leading-[21px] font-normal rounded-md"
                style={{
                  color: 'var(--text-tertiary, #808088)',
                  background: 'var(--bg-tertiary, #191a1e)',
                  border: '1px solid var(--border-primary, #28282e)',
                }}
              >
                {tr("No transactions yet")}
              </div>
            ) : (
              <div className="space-y-1.5">
                {transactions.map((transaction) => (
                  <TransactionRow key={transaction.id} transaction={transaction} />
                ))}
              </div>
            )}
          </div>

          {/* Section 3: Account Settings & Security */}
          <div className="p-3.5">
            <h3
              className="text-[12px] leading-[18px] font-normal uppercase tracking-wider mb-2.5"
              style={{ color: 'var(--text-tertiary, #808088)' }}
            >
              {tr("Account Settings")}
            </h3>

            <div className="space-y-2.5">
              {/* One-Click Trading Toggle (Connected to useSettingsStore) */}
              <div
                className="flex items-center justify-between px-3 py-2 rounded-md"
                style={{
                  background: 'var(--bg-tertiary, #191a1e)',
                  border: '1px solid var(--border-primary, #28282e)',
                }}
              >
                <div className="min-w-0 pr-2">
                  <div
                    className="text-[14px] leading-[21px] font-normal"
                    style={{ color: 'var(--text-primary, #e2e2e8)' }}
                  >
                    {tr("One-Click Trading")}
                  </div>
                  <div
                    className="text-[12px] leading-[18px] font-normal"
                    style={{ color: 'var(--text-tertiary, #808088)' }}
                  >
                    Execute orders without confirmation
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={oneClickTrading}
                  aria-label={tr("One-Click Trading")}
                  onClick={() => updateTradeSettings({ oneClickTrading: !oneClickTrading })}
                  className={`relative w-10 h-5 shrink-0 rounded-full transition-colors cursor-pointer ${
                    oneClickTrading ? 'bg-blue-600' : 'bg-zinc-600/60'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
                      oneClickTrading ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Change Password Action (Connected to ChangePasswordDialog) */}
              <button
                type="button"
                disabled={!activeLogin}
                onClick={() => setIsChangePasswordOpen(true)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-md text-[14px] leading-[21px] font-normal transition-colors hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: 'var(--bg-tertiary, #191a1e)',
                  border: '1px solid var(--border-primary, #28282e)',
                  color: 'var(--text-primary, #e2e2e8)',
                }}
              >
                <div className="flex items-center gap-2">
                  <Icon name="lock" size="sm" className="w-3.5 h-3.5 text-blue-400" />
                  <span>{tr("Change Password")}</span>
                </div>
                <Icon name="chevron-right" size="sm" className="w-3.5 h-3.5 opacity-60" />
              </button>

              {/* Institutional Notice for Broker Portal Operations */}
              <div
                className="rounded-md p-2.5 text-[12px] leading-[18px] font-normal"
                style={{
                  background: 'var(--bg-tertiary, #191a1e)',
                  border: '1px solid var(--border-primary, #28282e)',
                  color: 'var(--text-tertiary, #808088)',
                }}
              >
                Deposits, withdrawals, and leverage adjustments are managed through your broker&apos;s client portal.
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Change Password Modal */}
      <ChangePasswordDialog
        isOpen={isChangePasswordOpen}
        onClose={() => setIsChangePasswordOpen(false)}
        accountLogin={activeLogin ? String(activeLogin) : undefined}
      />
    </>
  );
};

/**
 * Balance Row Component
 */
interface BalanceRowProps {
  label: string;
  value: number;
  currency?: string;
  suffix?: string;
  valueColor?: string;
}

const BalanceRow: React.FC<BalanceRowProps> = ({ label, value, currency, suffix, valueColor = '' }) => {
  const tr = useUiTranslation();
  const prevRef = useRef(value);
  const [flashClass, setFlashClass] = useState('');

  useEffect(() => {
    if (value > prevRef.current) {
      setFlashClass('bg-emerald-500/25 text-emerald-400 transition-none');
      const timer = setTimeout(() => setFlashClass('transition-colors duration-500'), 120);
      prevRef.current = value;
      return () => clearTimeout(timer);
    }
    if (value < prevRef.current) {
      setFlashClass('bg-red-500/25 text-red-400 transition-none');
      const timer = setTimeout(() => setFlashClass('transition-colors duration-500'), 120);
      prevRef.current = value;
      return () => clearTimeout(timer);
    }
    prevRef.current = value;
    return undefined;
  }, [value]);

  return (
    <div
      className="flex items-center justify-between py-1.5"
      style={{ borderBottom: '1px solid var(--border-primary, #28282e)' }}
    >
      <span
        className="text-[14px] leading-[21px] font-normal"
        style={{ color: 'var(--text-secondary, #808088)' }}
      >
        {tr(label)}
      </span>
      <span
        className={`text-[14px] leading-[21px] font-semibold font-mono tabular-nums px-1 rounded-sm inline-block ${valueColor} ${flashClass}`}
        style={!valueColor ? { color: 'var(--text-primary, #e2e2e8)' } : undefined}
      >
        {currency && `${currency} `}
        {value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        {suffix}
      </span>
    </div>
  );
};

/**
 * Transaction Row Component
 */
interface TransactionRowProps {
  transaction: Transaction;
}

const TransactionRow: React.FC<TransactionRowProps> = ({ transaction }) => {
  const typeColor = transaction.type === 'deposit' ? 'text-emerald-400' : 'text-rose-400';
  const statusConfig = {
    pending: { color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30', label: 'Pending' },
    completed: { color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: 'Completed' },
    failed: { color: 'bg-rose-500/15 text-rose-400 border-rose-500/30', label: 'Failed' },
  };

  const status = statusConfig[transaction.status];

  return (
    <div
      className="flex items-center justify-between p-2.5 rounded-md transition-colors"
      style={{
        background: 'var(--bg-tertiary, #191a1e)',
        border: '1px solid var(--border-primary, #28282e)',
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-[13px] leading-[19.5px] font-medium ${typeColor} capitalize`}>
            {transaction.type}
          </span>
          <span className={`text-[10px] px-1.5 py-0.2 rounded border ${status.color} font-medium`}>
            {status.label}
          </span>
        </div>
        <div
          className="text-[12px] leading-[18px] font-normal"
          style={{ color: 'var(--text-tertiary, #808088)' }}
        >
          {new Date(transaction.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      </div>
      <div className={`text-[14px] leading-[21px] font-semibold font-mono tabular-nums ${typeColor}`}>
        {transaction.type === 'deposit' ? '+' : '-'}${transaction.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
      </div>
    </div>
  );
};

/**
 * Utility Functions
 */

function getMarginLevelColor(marginLevel: number): string {
  if (marginLevel <= 0) return '';
  if (marginLevel < 50) return 'text-rose-400';
  if (marginLevel < 100) return 'text-yellow-400';
  return 'text-emerald-400';
}

