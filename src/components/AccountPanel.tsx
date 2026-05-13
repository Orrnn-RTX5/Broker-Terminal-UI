/**
 * Account Management Panel
 * Comprehensive account management sidebar for traders
 */

import { Icon } from './ui/Icon';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { getStoredAccountLogin, tradeGatewayApi } from '../api/tradeGateway';

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

export const AccountPanel: React.FC<AccountPanelProps> = ({ onClose, wsConnection }) => {
  const { account, accountId } = useAppStore();
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);
  const [leverage, setLeverage] = useState<number>(100);
  const [oneClickTrading, setOneClickTrading] = useState(false);
  const [accountInfo, setAccountInfo] = useState({
    accountNumber: '...',
    accountType: '...',
    leverage: leverage,
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
          accountType: 'Standard',
          leverage: data.leverage || 100,
        });
        setLeverage(data.leverage || 100);
      } catch (err) {
        console.error('Failed to fetch account profile:', err);
      }
    };
    fetchProfile();
  }, [accountId]);

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

  const handleUnsupportedAccountAction = (action: string) => {
    console.info(`${action} is not supported by the trade-facing API contract`);
  };

  return (
    <>
      <div className="w-80 h-full bg-[#131316] border-l border-zinc-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-[#252525]">
          <div className="flex items-center gap-2">
            <Icon name="credit-card" size="sm" className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-bold text-zinc-200">Account Management</h2>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <Icon name="x-close" size="sm" className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {/* Section 1: Account Summary */}
          <div className="p-4 border-b border-zinc-800">
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">Account Summary</h3>

            {/* Account Info */}
            <div className="bg-[#252525] rounded-lg p-3 mb-3 border border-zinc-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-zinc-500">Account</span>
                <span className="text-xs font-mono text-zinc-300 font-bold">{accountInfo.accountNumber}</span>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-zinc-500">Type</span>
                <span className="text-xs text-blue-400 font-medium">{accountInfo.accountType}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-500">Leverage</span>
                <span className="text-xs text-zinc-300 font-bold">1:{accountInfo.leverage}</span>
              </div>
            </div>

            {/* Balance Info */}
            <div className="space-y-2">
              <BalanceRow label="Balance" value={account?.balance || 0} currency={account?.currency || 'USD'} />
              <BalanceRow label="Equity" value={account?.equity || 0} currency={account?.currency || 'USD'} valueColor="text-emerald-400" />
              <BalanceRow label="Free Margin" value={account?.freeMargin || 0} currency={account?.currency || 'USD'} />
              <BalanceRow
                label="Margin Level"
                value={account?.marginLevel || 0}
                suffix="%"
                valueColor={getMarginLevelColor(account?.marginLevel || 0)}
              />
            </div>
          </div>

          {/* Section 2: Deposit/Withdraw Buttons */}
          <div className="p-4 border-b border-zinc-800">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled
                title="Deposits are not supported by the trade-facing API contract"
                onClick={() => handleUnsupportedAccountAction('Deposit')}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-800/50 border border-zinc-700 rounded-lg text-zinc-500 text-sm font-medium cursor-not-allowed"
              >
                <Icon name="trending-up" size="sm" className="w-4 h-4" />
                Deposit
              </button>
              <button
                type="button"
                disabled
                title="Withdrawals are not supported by the trade-facing API contract"
                onClick={() => handleUnsupportedAccountAction('Withdrawal')}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-800/50 border border-zinc-700 rounded-lg text-zinc-500 text-sm font-medium cursor-not-allowed"
              >
                <Icon name="trending-up" size="sm" className="w-4 h-4 rotate-180" />
                Withdraw
              </button>
            </div>
          </div>

          {/* Section 3: Transaction History */}
          <div className="p-4 border-b border-zinc-800">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Transaction History</h3>
              <button className="text-[10px] text-blue-400 hover:text-zinc-300 transition-colors font-medium">
                View All
              </button>
            </div>

            {isLoadingTransactions ? (
              <div className="text-center py-6 text-zinc-600 text-xs">
                Loading transactions...
              </div>
            ) : transactions.length === 0 ? (
              <div className="text-center py-6 text-zinc-600 text-xs">
                No transactions yet
              </div>
            ) : (
              <div className="space-y-2">
                {transactions.map((transaction) => (
                  <TransactionRow key={transaction.id} transaction={transaction} />
                ))}
              </div>
            )}
          </div>

          {/* Section 4: Account Settings */}
          <div className="p-4">
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">Account Settings</h3>

            <div className="space-y-3">
              {/* Leverage Selector */}
              <div className="flex items-center justify-between py-2">
                <span className="text-xs text-zinc-400">Leverage</span>
                <select
                  value={leverage}
                  disabled
                  onChange={() => undefined}
                  title="Leverage changes are not supported by the trade API"
                  className="bg-[#252525] border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-500 focus:outline-none cursor-not-allowed"
                >
                  <option value={50}>1:50</option>
                  <option value={100}>1:100</option>
                  <option value={200}>1:200</option>
                  <option value={500}>1:500</option>
                </select>
              </div>

              {/* Change Password Button */}
              <button
                type="button"
                disabled
                title="Password changes are not supported by the trade-facing API contract"
                onClick={() => handleUnsupportedAccountAction('Password changes')}
                className="w-full flex items-center justify-between px-3 py-2 bg-[#252525] border border-zinc-700 rounded-lg text-xs text-zinc-500 cursor-not-allowed"
              >
                <div className="flex items-center gap-2">
                  <Icon name="lock" size="sm" className="w-3.5 h-3.5 text-zinc-500" />
                  <span>Change Password</span>
                </div>
                <Icon name="chevron-right" size="sm" className="w-3.5 h-3.5 text-zinc-600" />
              </button>

              {/* One-Click Trading Toggle */}
              <div className="flex items-center justify-between py-2">
                <span className="text-xs text-zinc-400">One-Click Trading</span>
                <button
                  type="button"
                  disabled
                  title="One-click trading settings are not supported by the trade-facing API contract"
                  onClick={() => handleUnsupportedAccountAction('One-click trading settings')}
                  className={`relative w-10 h-5 rounded-full transition-colors cursor-not-allowed opacity-60 ${oneClickTrading ? 'bg-emerald-500' : 'bg-zinc-700'
                    }`}
                >
                  <div
                    className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${oneClickTrading ? 'translate-x-5' : 'translate-x-0'
                      }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
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

const BalanceRow: React.FC<BalanceRowProps> = ({ label, value, currency, suffix, valueColor = 'text-zinc-200' }) => {
  const prevRef = useRef(value);
  const [color, setColor] = useState(valueColor);

  useEffect(() => {
    if (value > prevRef.current) {
      setColor(`bg-emerald-500/40 text-emerald-400 transition-none`);
      setTimeout(() => setColor(`${valueColor} transition-colors duration-500`), 50);
    } else if (value < prevRef.current) {
      setColor(`bg-red-500/40 text-red-400 transition-none`);
      setTimeout(() => setColor(`${valueColor} transition-colors duration-500`), 50);
    }
    prevRef.current = value;
  }, [value, valueColor]);

  return (
    <div className="flex items-center justify-between py-1.5 border-b border-zinc-800/50">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`text-sm font-bold font-mono px-0.5 rounded-sm inline-block ${color}`}>
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
    pending: { color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', label: 'Pending' },
    completed: { color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', label: 'Completed' },
    failed: { color: 'bg-rose-500/20 text-rose-400 border-rose-500/30', label: 'Failed' },
  };

  const status = statusConfig[transaction.status];

  return (
    <div className="flex items-center justify-between p-2 bg-[#252525] rounded border border-zinc-800 hover:bg-zinc-800/30 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs font-bold ${typeColor} capitalize`}>{transaction.type}</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded border ${status.color} font-medium`}>
            {status.label}
          </span>
        </div>
        <div className="text-[10px] text-zinc-600">{new Date(transaction.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
      </div>
      <div className={`text-sm font-bold font-mono ${typeColor}`}>
        {transaction.type === 'deposit' ? '+' : '-'}${transaction.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
      </div>
    </div>
  );
};

/**
 * Payment Modal (Deposit/Withdrawal)
 */
interface PaymentModalProps {
  type: 'deposit' | 'withdrawal';
  onClose: () => void;
}

const PaymentModal: React.FC<PaymentModalProps> = ({ type, onClose }) => {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('card');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(false);
    setSuccess(false);
    setError(`${type === 'deposit' ? 'Deposits' : 'Withdrawals'} are not supported by the trade-facing API contract.`);
  };

  const title = type === 'deposit' ? 'Deposit Funds' : 'Withdraw Funds';
  const buttonColor = type === 'deposit' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-rose-500 hover:bg-rose-600';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999]" onClick={onClose}>
      <div className="bg-[#131316] border border-zinc-800 rounded-lg shadow-2xl w-96 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-zinc-200">{title}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <Icon name="x-close" size="sm" className="w-5 h-5" />
          </button>
        </div>

        {success ? (
          <div className="py-8 text-center">
            <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm text-zinc-300 font-medium">
              {type === 'deposit' ? 'Deposit' : 'Withdrawal'} request submitted successfully!
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Amount Input */}
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5">Amount (USD)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                step="0.01"
                min="0"
                required
                className="w-full px-3 py-2 bg-[#252525] border border-zinc-700 rounded text-sm text-zinc-300 focus:outline-none focus:border-zinc-600"
              />
            </div>

            {/* Payment Method */}
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5">Payment Method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full px-3 py-2 bg-[#252525] border border-zinc-700 rounded text-sm text-zinc-300 focus:outline-none focus:border-zinc-600"
              >
                <option value="card">Credit/Debit Card</option>
                <option value="bank">Bank Transfer</option>
                <option value="crypto">Cryptocurrency</option>
              </select>
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded text-xs text-rose-400">
                {error}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || !amount}
              className={`w-full py-2.5 ${buttonColor} text-white text-sm font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {loading ? 'Processing...' : `Submit ${type === 'deposit' ? 'Deposit' : 'Withdrawal'}`}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

/**
 * Password Change Modal
 */
interface PasswordModalProps {
  onClose: () => void;
}

const PasswordModal: React.FC<PasswordModalProps> = ({ onClose }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccess(false);
    setError('Password changes are not supported by the trade-facing API contract.');

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999]" onClick={onClose}>
      <div className="bg-[#131316] border border-zinc-800 rounded-lg shadow-2xl w-96 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-zinc-200">Change Password</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <Icon name="x-close" size="sm" className="w-5 h-5" />
          </button>
        </div>

        {success ? (
          <div className="py-8 text-center">
            <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm text-zinc-300 font-medium">Password changed successfully!</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="w-full px-3 py-2 bg-[#252525] border border-zinc-700 rounded text-sm text-zinc-300 focus:outline-none focus:border-zinc-600"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-500 mb-1.5">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className="w-full px-3 py-2 bg-[#252525] border border-zinc-700 rounded text-sm text-zinc-300 focus:outline-none focus:border-zinc-600"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-500 mb-1.5">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full px-3 py-2 bg-[#252525] border border-zinc-700 rounded text-sm text-zinc-300 focus:outline-none focus:border-zinc-600"
              />
            </div>

            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded text-xs text-rose-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Updating...' : 'Change Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

/**
 * Utility Functions
 */

function getMarginLevelColor(marginLevel: number): string {
  if (marginLevel < 50) return 'text-rose-400';
  if (marginLevel < 100) return 'text-yellow-400';
  return 'text-emerald-400';
}

