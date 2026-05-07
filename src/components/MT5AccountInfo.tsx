/**
 * MT5 Account Info Display
 * Shows MT5 account balance, equity, margin when MT5 mode is active
 */

import { Icon } from './ui/Icon';
import { useMT5Store } from '../store/useMT5Store';
export function MT5AccountInfo() {
  const { account, connected } = useMT5Store();
  const mt5Enabled = localStorage.getItem('rtx5_mt5_mode') === 'true';

  // Only show when MT5 mode is enabled and connected
  if (!mt5Enabled || !connected || !account) {
    return null;
  }

  const formatMoney = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(val);
  };

  const marginLevel = account.margin_level || 0;
  const isLowMargin = marginLevel < 150 && marginLevel > 0;
  const isCriticalMargin = marginLevel < 100 && marginLevel > 0;

  return (
    <div className="flex items-center gap-3 px-3 py-1 bg-[#252525] rounded border border-zinc-800 text-[10px] font-mono">
      {/* Balance */}
      <div className="flex items-center gap-1">
        <Icon name="credit-card" size="xs" className="text-zinc-500" />
        <span className="text-zinc-500">Bal:</span>
        <span className="text-zinc-200 font-bold">{formatMoney(account.balance)}</span>
      </div>

      <span className="w-[1px] h-3 bg-zinc-700"></span>

      {/* Equity */}
      <div className="flex items-center gap-1">
        <Icon name="trending-up" size="xs" className="text-emerald-500" />
        <span className="text-zinc-500">Eq:</span>
        <span className="text-emerald-400 font-bold">{formatMoney(account.equity)}</span>
      </div>

      <span className="w-[1px] h-3 bg-zinc-700"></span>

      {/* Free Margin */}
      <div className="flex items-center gap-1">
        <Icon name="shield" size="xs" className="text-blue-500" />
        <span className="text-zinc-500">Free:</span>
        <span className="text-blue-400 font-bold">{formatMoney(account.free_margin)}</span>
      </div>

      {/* Margin Level */}
      {marginLevel > 0 && (
        <>
          <span className="w-[1px] h-3 bg-zinc-700"></span>
          <div className="flex items-center gap-1">
            <span className="text-zinc-500">ML:</span>
            <span
              className={`font-bold ${
                isCriticalMargin
                  ? 'text-red-500 animate-pulse'
                  : isLowMargin
                  ? 'text-yellow-500'
                  : 'text-emerald-500'
              }`}
            >
              {marginLevel.toFixed(0)}%
            </span>
          </div>
        </>
      )}

      {/* Currency */}
      <span className="text-zinc-600 text-[9px] ml-1">{account.currency}</span>
    </div>
  );
}
