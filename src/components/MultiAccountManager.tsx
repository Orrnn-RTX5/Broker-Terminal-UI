/**
 * Multi-Account Manager (MAM) Panel
 * Manage multiple trading accounts with real-time updates and switching
 */

import { Icon } from './ui/Icon';
import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';

type AccountStatus = 'Active' | 'Suspended' | 'Margin Call';
type SortField = 'id' | 'name' | 'balance' | 'equity' | 'margin' | 'freeMargin' | 'profit';
type SortDirection = 'asc' | 'desc';

interface ManagedAccount {
  id: string;
  name: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  profit: number;
  status: AccountStatus;
}

export function MultiAccountManager() {
  const accountId = useAppStore((state) => state.accountId);
  const setAuthenticated = useAppStore((state) => state.setAuthenticated);
  const setAccount = useAppStore((state) => state.setAccount);

  // TODO: Replace with API call to /api/accounts
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | AccountStatus>('All');
  const [sortField, setSortField] = useState<SortField>('id');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [amountDialog, setAmountDialog] = useState<{ mode: 'deposit' | 'withdraw'; acc: ManagedAccount } | null>(null);
  const [amountInput, setAmountInput] = useState('');

  // Real-time equity/profit updates (every 2 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      setAccounts((prev) =>
        prev.map((acc) => {
          // Simulate small price movements
          const priceChange = (Math.random() - 0.5) * 100;
          const newProfit = acc.profit + priceChange;
          const newEquity = acc.balance + newProfit;
          const marginLevel = acc.margin > 0 ? (newEquity / acc.margin) * 100 : 999;

          // Update status based on margin level
          let newStatus: AccountStatus = 'Active';
          if (acc.status === 'Suspended') {
            newStatus = 'Suspended';
          } else if (marginLevel < 100) {
            newStatus = 'Margin Call';
          }

          return {
            ...acc,
            profit: newProfit,
            equity: newEquity,
            freeMargin: newEquity - acc.margin,
            status: newStatus,
          };
        })
      );
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  // Filter accounts
  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      // Search filter
      const matchesSearch =
        searchQuery === '' ||
        acc.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        acc.name.toLowerCase().includes(searchQuery.toLowerCase());

      // Status filter
      const matchesStatus = statusFilter === 'All' || acc.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [accounts, searchQuery, statusFilter]);

  // Sort accounts
  const sortedAccounts = useMemo(() => {
    const sorted = [...filteredAccounts];
    sorted.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }

      return 0;
    });
    return sorted;
  }, [filteredAccounts, sortField, sortDirection]);

  // Calculate summary totals
  const summaryTotals = useMemo(() => {
    return accounts.reduce(
      (totals, acc) => ({
        totalBalance: totals.totalBalance + acc.balance,
        totalEquity: totals.totalEquity + acc.equity,
        totalMarginUsed: totals.totalMarginUsed + acc.margin,
        totalFreeMargin: totals.totalFreeMargin + acc.freeMargin,
      }),
      { totalBalance: 0, totalEquity: 0, totalMarginUsed: 0, totalFreeMargin: 0 }
    );
  }, [accounts]);

  // Handle column sort
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Handle account switch
  const handleSwitchAccount = (acc: ManagedAccount) => {
    setAuthenticated(true, acc.id);
    setAccount({
      balance: acc.balance,
      equity: acc.equity,
      margin: acc.margin,
      freeMargin: acc.freeMargin,
      unrealizedPL: acc.profit,
      marginLevel: acc.margin > 0 ? (acc.equity / acc.margin) * 100 : 999,
      currency: 'USD',
      leverage: 100,
    });
  };

  // Handle deposit
  const handleDeposit = (acc: ManagedAccount) => {
    setAmountDialog({ mode: 'deposit', acc });
    setAmountInput('');
  };

  // Handle withdraw
  const handleWithdraw = (acc: ManagedAccount) => {
    setAmountDialog({ mode: 'withdraw', acc });
    setAmountInput('');
  };

  const handleAmountConfirm = () => {
    if (!amountDialog) return;
    const amount = parseFloat(amountInput);
    if (isNaN(amount) || amount <= 0) return;
    const { mode, acc } = amountDialog;
    if (mode === 'withdraw' && amount > acc.freeMargin) {
      alert('Insufficient free margin for withdrawal');
      return;
    }
    const sign = mode === 'deposit' ? 1 : -1;
    setAccounts((prev) =>
      prev.map((a) =>
        a.id === acc.id
          ? { ...a, balance: a.balance + sign * amount, equity: a.equity + sign * amount, freeMargin: a.freeMargin + sign * amount }
          : a
      )
    );
    setAmountDialog(null);
  };

  const getStatusColor = (status: AccountStatus): string => {
    switch (status) {
      case 'Active':
        return 'bg-green-500/20 text-green-400 border-green-500/50';
      case 'Margin Call':
        return 'bg-red-500/20 text-red-400 border-red-500/50';
      case 'Suspended':
        return 'bg-gray-500/20 text-gray-400 border-gray-500/50';
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#131316] text-zinc-300 overflow-hidden">
      {/* Header */}
      <div className="bg-[#252528] border-b border-zinc-700 p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Icon name="user" size="lg" />
            Multi-Account Manager
          </h2>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <SummaryCard
            icon={<Icon name="credit-card" size="lg" />}
            label="Total Balance"
            value={`$${summaryTotals.totalBalance.toFixed(2)}`}
            color="text-blue-400"
          />
          <SummaryCard
            icon={<Icon name="trending-up" size="lg" />}
            label="Total Equity"
            value={`$${summaryTotals.totalEquity.toFixed(2)}`}
            color="text-green-400"
          />
          <SummaryCard
            icon={<Icon name="crosshair" size="lg" />}
            label="Total Margin Used"
            value={`$${summaryTotals.totalMarginUsed.toFixed(2)}`}
            color="text-yellow-400"
          />
          <SummaryCard
            icon={<Icon name="credit-card" size="lg" />}
            label="Total Free Margin"
            value={`$${summaryTotals.totalFreeMargin.toFixed(2)}`}
            color="text-purple-400"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap text-xs">
          {/* Search */}
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Icon name="search" size="sm" className="text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by account ID or name..."
              className="flex-1 bg-[#131316] border border-zinc-700 rounded px-2 py-1.5 outline-none focus:border-zinc-600 text-zinc-300 placeholder:text-zinc-600"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <label className="text-zinc-400">Status:</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'All' | AccountStatus)}
              className="bg-[#131316] border border-zinc-700 rounded px-2 py-1.5 outline-none focus:border-zinc-600"
            >
              <option value="All">All</option>
              <option value="Active">Active</option>
              <option value="Margin Call">Margin Call</option>
              <option value="Suspended">Suspended</option>
            </select>
          </div>
        </div>
      </div>

      {/* Accounts Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-[#252528] sticky top-0 z-10">
            <tr className="border-b border-zinc-700">
              <SortableHeader label="Account ID" field="id" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Name" field="name" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Balance" field="balance" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Equity" field="equity" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Margin" field="margin" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Free Margin" field="freeMargin" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Profit" field="profit" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
              <th className="px-4 py-2 text-left font-medium text-zinc-400">Status</th>
              <th className="px-4 py-2 text-left font-medium text-zinc-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedAccounts.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-zinc-500">
                  No accounts found
                </td>
              </tr>
            ) : (
              <>
                {sortedAccounts.map((acc) => {
                  const isActive = acc.id === accountId;
                  return (
                    <tr
                      key={acc.id}
                      className={`border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors ${isActive ? 'bg-blue-950/20 border-l-2 border-l-blue-500' : ''
                        }`}
                    >
                      <td className="px-4 py-3 font-medium text-white">{acc.id}</td>
                      <td className="px-4 py-3">{acc.name}</td>
                      <td className="px-4 py-3">${acc.balance.toFixed(2)}</td>
                      <td className="px-4 py-3">${acc.equity.toFixed(2)}</td>
                      <td className="px-4 py-3">${acc.margin.toFixed(2)}</td>
                      <td className="px-4 py-3">${acc.freeMargin.toFixed(2)}</td>
                      <td className={`px-4 py-3 font-medium ${acc.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ${acc.profit.toFixed(2)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded border text-[10px] font-medium ${getStatusColor(acc.status)}`}>
                          {acc.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {!isActive && (
                            <button
                              onClick={() => handleSwitchAccount(acc)}
                              className="px-2 py-1 bg-zinc-700 hover:bg-zinc-600 text-white rounded text-[10px] font-medium transition-colors"
                            >
                              Switch
                            </button>
                          )}
                          {isActive && (
                            <span className="px-2 py-1 bg-green-600/20 text-green-400 rounded text-[10px] font-medium">
                              Active
                            </span>
                          )}
                          <button
                            onClick={() => handleDeposit(acc)}
                            className="px-2 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-[10px] font-medium transition-colors"
                          >
                            Deposit
                          </button>
                          <button
                            onClick={() => handleWithdraw(acc)}
                            className="px-2 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-[10px] font-medium transition-colors"
                          >
                            Withdraw
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {/* Totals Row */}
                <tr className="bg-[#131316] border-t-2 border-zinc-600 font-bold sticky bottom-0">
                  <td colSpan={2} className="px-4 py-3 text-white">
                    Total ({sortedAccounts.length} accounts)
                  </td>
                  <td className="px-4 py-3 text-blue-400">
                    ${sortedAccounts.reduce((sum, a) => sum + a.balance, 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-green-400">
                    ${sortedAccounts.reduce((sum, a) => sum + a.equity, 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-yellow-400">
                    ${sortedAccounts.reduce((sum, a) => sum + a.margin, 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-purple-400">
                    ${sortedAccounts.reduce((sum, a) => sum + a.freeMargin, 0).toFixed(2)}
                  </td>
                  <td
                    className={`px-4 py-3 ${sortedAccounts.reduce((sum, a) => sum + a.profit, 0) >= 0
                        ? 'text-green-400'
                        : 'text-red-400'
                      }`}
                  >
                    ${sortedAccounts.reduce((sum, a) => sum + a.profit, 0).toFixed(2)}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
      {/* Amount Dialog for Deposit/Withdraw */}
      {amountDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]" onClick={() => setAmountDialog(null)}>
          <div className="bg-[#1e222d] border border-zinc-600 rounded-lg shadow-2xl p-5 w-72" onClick={e => e.stopPropagation()}>
            <div className="text-sm font-semibold text-zinc-100 mb-1 capitalize">{amountDialog.mode}</div>
            <div className="text-xs text-zinc-400 mb-3">{amountDialog.acc.name}</div>
            <input
              type="number"
              value={amountInput}
              onChange={e => setAmountInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAmountConfirm(); if (e.key === 'Escape') setAmountDialog(null); }}
              autoFocus
              placeholder="Enter amount (USD)"
              min="0"
              className="w-full bg-[#131316] border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-blue-500 mb-3"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setAmountDialog(null)} className="px-3 py-1.5 text-xs bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600">Cancel</button>
              <button
                onClick={handleAmountConfirm}
                disabled={!amountInput || isNaN(parseFloat(amountInput)) || parseFloat(amountInput) <= 0}
                className={`px-3 py-1.5 text-xs text-white rounded disabled:opacity-50 ${
                  amountDialog.mode === 'deposit' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {amountDialog.mode === 'deposit' ? 'Deposit' : 'Withdraw'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper Components
interface SummaryCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}

function SummaryCard({ icon, label, value, color }: SummaryCardProps) {
  return (
    <div className="bg-[#131316] border border-zinc-700 rounded p-3">
      <div className="flex items-center gap-2 mb-1">
        <div className={color}>{icon}</div>
        <span className="text-[10px] text-zinc-400 uppercase">{label}</span>
      </div>
      <div className={`text-base font-bold ${color}`}>{value}</div>
    </div>
  );
}

interface SortableHeaderProps {
  label: string;
  field: SortField;
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
}

function SortableHeader({ label, field, sortField, sortDirection, onSort }: SortableHeaderProps) {
  const isActive = sortField === field;
  return (
    <th
      onClick={() => onSort(field)}
      className="px-4 py-2 text-left font-medium text-zinc-400 cursor-pointer hover:text-white transition-colors select-none"
    >
      <div className="flex items-center gap-1">
        {label}
        {isActive && (
          <span className="text-blue-400">
            {sortDirection === 'asc' ? '↑' : '↓'}
          </span>
        )}
      </div>
    </th>
  );
}

// TODO: Replace with API call to /api/accounts
function generateMockAccounts(): ManagedAccount[] {
  // Placeholder: Returns empty array until backend API is implemented
  return [];
}
