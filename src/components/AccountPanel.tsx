import { useUiTranslation } from '../hooks/useUiTranslation';
/**
 * Account Management Panel
 * Comprehensive account management sidebar for traders
 */

import { Icon } from './ui/Icon';
import React, { useState, useEffect, useRef } from 'react';
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

export const AccountPanel: React.FC<AccountPanelProps> = ({ onClose }) => {
    const tr = useUiTranslation();
  const { account, accountId } = useAppStore();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);
  const [leverage, setLeverage] = useState<number>(100);
  const [oneClickTrading] = useState(false);
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
        <div className="flex min-h-[30px] items-center justify-between px-4 py-1 border-b border-zinc-800 bg-[#252525]">
          <div className="flex items-center gap-2">
            <Icon name="credit-card" size="sm" className="w-4 h-4 text-blue-400" />
            <h2 className="text-[14px] leading-[21px] font-normal text-zinc-200">{tr("Account Management")}</h2>
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
            <h3 className="text-[12px] leading-[18px] font-normal text-zinc-500 uppercase tracking-normal mb-3">{tr("Account Summary")}</h3>

            {/* Account Info */}
            <div className="bg-[#252525] rounded-lg p-3 mb-3 border border-zinc-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[14px] leading-[21px] font-normal text-zinc-500">{tr("Account")}</span>
                <span className="text-[14px] leading-[21px] font-mono text-zinc-300 font-normal">{accountInfo.accountNumber}</span>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[14px] leading-[21px] font-normal text-zinc-500">{tr("Type")}</span>
                <span className="text-[14px] leading-[21px] text-blue-400 font-normal">{accountInfo.accountType}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[14px] leading-[21px] font-normal text-zinc-500">{tr("Leverage")}</span>
                <span className="text-[14px] leading-[21px] text-zinc-300 font-normal">1:{accountInfo.leverage}</span>
              </div>
            </div>

            {/* Balance Info */}
            <div className="space-y-2">
              <BalanceRow label={tr("Balance")} value={account?.balance || 0} currency={account?.currency || 'USD'} />
              <BalanceRow label={tr("Equity")} value={account?.equity || 0} currency={account?.currency || 'USD'} valueColor="text-emerald-400" />
              <BalanceRow label={tr("Free Margin")} value={account?.freeMargin || 0} currency={account?.currency || 'USD'} />
              <BalanceRow
                label={tr("Margin Level")}
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
                title={tr("Deposits are not supported by the trade-facing API contract")}
                onClick={() => handleUnsupportedAccountAction('Deposit')}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-800/50 border border-zinc-700 rounded-lg text-zinc-500 text-[14px] leading-[21px] font-normal cursor-not-allowed"
              >
                <Icon name="trending-up" size="sm" className="w-4 h-4" />
                {tr("Deposit")}</button>
              <button
                type="button"
                disabled
                title={tr("Withdrawals are not supported by the trade-facing API contract")}
                onClick={() => handleUnsupportedAccountAction('Withdrawal')}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-800/50 border border-zinc-700 rounded-lg text-zinc-500 text-[14px] leading-[21px] font-normal cursor-not-allowed"
              >
                <Icon name="trending-up" size="sm" className="w-4 h-4 rotate-180" />
                {tr("Withdraw")}</button>
            </div>
          </div>

          {/* Section 3: Transaction History */}
          <div className="p-4 border-b border-zinc-800">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[12px] leading-[18px] font-normal text-zinc-500 uppercase tracking-normal">{tr("Transaction History")}</h3>
              <button className="text-[12px] leading-[18px] text-blue-400 hover:text-zinc-300 transition-colors font-normal">
                {tr("View All")}</button>
            </div>

            {isLoadingTransactions ? (
              <div className="text-center py-6 text-zinc-600 text-[14px] leading-[21px] font-normal">
                {tr("Loading transactions...")}</div>
            ) : transactions.length === 0 ? (
              <div className="text-center py-6 text-zinc-600 text-[14px] leading-[21px] font-normal">
                {tr("No transactions yet")}</div>
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
            <h3 className="text-[12px] leading-[18px] font-normal text-zinc-500 uppercase tracking-normal mb-3">{tr("Account Settings")}</h3>

            <div className="space-y-3">
              {/* Leverage Selector */}
              <div className="flex items-center justify-between py-2">
                <span className="text-[14px] leading-[21px] font-normal text-zinc-400">{tr("Leverage")}</span>
                <select
                  value={leverage}
                  disabled
                  onChange={() => undefined}
                  title={tr("Leverage changes are not supported by the trade API")}
                  className="bg-[#252525] border border-zinc-700 rounded px-2 py-1 text-[14px] leading-[21px] font-normal text-zinc-500 focus:outline-none cursor-not-allowed"
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
                title={tr("Password changes are not supported by the trade-facing API contract")}
                onClick={() => handleUnsupportedAccountAction('Password changes')}
                className="w-full flex items-center justify-between px-3 py-2 bg-[#252525] border border-zinc-700 rounded-lg text-[14px] leading-[21px] font-normal text-zinc-500 cursor-not-allowed"
              >
                <div className="flex items-center gap-2">
                  <Icon name="lock" size="sm" className="w-3.5 h-3.5 text-zinc-500" />
                  <span>{tr("Change Password")}</span>
                </div>
                <Icon name="chevron-right" size="sm" className="w-3.5 h-3.5 text-zinc-600" />
              </button>

              {/* One-Click Trading Toggle */}
              <div className="flex items-center justify-between py-2">
                <span className="text-[14px] leading-[21px] font-normal text-zinc-400">{tr("One-Click Trading")}</span>
                <button
                  type="button"
                  disabled
                  title={tr("One-click trading settings are not supported by the trade-facing API contract")}
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
    const tr = useUiTranslation();
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
      <span className="text-[14px] leading-[21px] font-normal text-zinc-500">{tr(label)}</span>
      <span className={`text-[14px] leading-[21px] font-semibold font-mono px-0.5 rounded-sm inline-block ${color}`}>
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
          <span className={`text-[13px] leading-[19.5px] font-medium ${typeColor} capitalize`}>{transaction.type}</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded border ${status.color} font-medium`}>
            {status.label}
          </span>
        </div>
        <div className="text-[12px] leading-[18px] font-normal text-zinc-600">{new Date(transaction.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
      </div>
      <div className={`text-[14px] leading-[21px] font-semibold font-mono ${typeColor}`}>
        {transaction.type === 'deposit' ? '+' : '-'}${transaction.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
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

