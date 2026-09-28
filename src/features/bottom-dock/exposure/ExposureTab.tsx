import { useEffect, useMemo, useState } from 'react';
import { useUiTranslation } from '../../../hooks/useUiTranslation';
import { useLiveAccountMetrics } from '../../../hooks/useLiveAccountMetrics';
import {
  buildExposureSummary,
  formatExposureVolume,
  type ExposureAccountInput,
  type ExposurePositionInput,
} from '../../../components/BottomDock.exposure';

const METRIC_UNAVAILABLE = '\u2014';

export type ExposureTabProps = {
  positions: ExposurePositionInput[];
  formatMoney: (value: number | undefined | null) => string;
  account: ExposureAccountInput | null;
};

const getAssetBadgeStyle = (asset: string) => {
  const code = asset.toUpperCase();
  if (code === 'USD') return { icon: '$', badgeClass: 'bg-amber-500/15 border-amber-500/40 text-amber-400', textClass: 'text-amber-400' };
  if (code === 'EUR') return { icon: '\u20ac', badgeClass: 'bg-sky-500/15 border-sky-500/40 text-sky-400', textClass: 'text-sky-400' };
  if (code === 'GBP') return { icon: '\u00a3', badgeClass: 'bg-purple-500/15 border-purple-500/40 text-purple-400', textClass: 'text-purple-400' };
  if (code === 'JPY') return { icon: '\u00a5', badgeClass: 'bg-rose-500/15 border-rose-500/40 text-rose-400', textClass: 'text-rose-400' };
  if (code === 'XAU') return { icon: '\ud83e\ude99', badgeClass: 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300', textClass: 'text-yellow-300' };
  if (code === 'XAG') return { icon: '\ud83e\ude88', badgeClass: 'bg-slate-400/20 border-slate-400/50 text-slate-300', textClass: 'text-slate-300' };
  if (code === 'BTC') return { icon: '\u20bf', badgeClass: 'bg-orange-500/20 border-orange-500/50 text-orange-400', textClass: 'text-orange-400' };
  if (code === 'ETH') return { icon: '\u039e', badgeClass: 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400', textClass: 'text-indigo-400' };
  return { icon: '$', badgeClass: 'bg-amber-500/15 border-amber-500/40 text-amber-400', textClass: 'text-amber-400' };
};

export function ExposureTab({ positions, formatMoney, account }: ExposureTabProps) {
  const tr = useUiTranslation();
  const exposure = useMemo(() => buildExposureSummary(positions ?? [], account), [positions, account]);
  const [metricsNow, setMetricsNow] = useState(Date.now);

  useEffect(() => {
    const timer = window.setInterval(() => setMetricsNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const {
    balance: accountBalance,
    equity: accountEquity,
    margin: accountMargin,
    freeMargin: accountFreeMargin,
    marginLevel: accountMarginLevel,
  } = useLiveAccountMetrics(account, positions, metricsNow);
  const formatAccountMetric = (value: number | null) => (
    value === null ? METRIC_UNAVAILABLE : formatMoney(value)
  );

  return (
    <div className="rtx-exposure-tab flex h-full bg-[#0a0b0e] text-[13px] font-normal">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[720px] table-fixed border-collapse text-left">
            <thead className="sticky top-0 z-10 border-b border-[#20222a] bg-[#0d0f14] text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              <tr className="h-[32px]">
                <th className="w-[140px] border-r border-zinc-800/80 p-1.5 pl-3">{tr('Assets')}</th>
                <th className="w-[130px] border-r border-zinc-800/80 p-1.5 text-right">{tr('Volume')}</th>
                <th className="w-[130px] border-r border-zinc-800/80 p-1.5 text-right">{tr('Rate')}</th>
                <th className="w-[140px] border-r border-zinc-800/80 p-1.5 text-right">{exposure.accountCurrency}</th>
                <th className="p-1.5 text-center">{tr('Graph')}</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[12.5px] leading-[20px] text-zinc-200">
              {exposure.rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="h-20 text-center font-sans text-[12px] text-zinc-500">
                    {tr('No active asset exposure')}
                  </td>
                </tr>
              ) : exposure.rows.map((row, index) => {
                const isLong = row.value >= 0;
                const badge = getAssetBadgeStyle(row.asset);
                return (
                  <tr
                    key={row.asset}
                    className={`h-[34px] border-b border-white/[0.02] transition-colors hover:bg-white/[0.03] ${index % 2 === 0 ? 'bg-[#111318]' : 'bg-[#0e0f14]'}`}
                  >
                    <td className="border-r border-zinc-800/80 p-1.5 pl-3 font-sans font-semibold">
                      <div className="inline-flex items-center gap-1.5">
                        <span className={`inline-flex h-[17px] w-[17px] items-center justify-center rounded-[3px] border text-[9.5px] font-bold ${badge.badgeClass}`}>
                          {badge.icon}
                        </span>
                        <span className={badge.textClass}>{row.asset}</span>
                      </div>
                    </td>
                    <td className="border-r border-zinc-800/80 p-1.5 text-right font-medium text-zinc-300">
                      {formatExposureVolume(row.asset, row.volume)}
                    </td>
                    <td className="border-r border-zinc-800/80 p-1.5 text-right text-zinc-400">
                      {row.rate.toFixed(5)}
                    </td>
                    <td className={`border-r border-zinc-800/80 p-1.5 text-right font-semibold ${isLong ? 'text-white' : 'text-rose-400'}`}>
                      {formatMoney(row.value)}
                    </td>
                    <td className="p-1.5 px-4 align-middle">
                      <div className="relative h-[13px] w-full min-w-[120px] overflow-hidden rounded-[3px] border border-white/[0.04] bg-[#161820]">
                        <div
                          className={`absolute top-0 h-full rounded-[2px] transition-all duration-300 ${isLong
                            ? 'left-0 bg-gradient-to-r from-[#0284c7] to-[#38bdf8] shadow-[0_0_8px_rgba(56,189,248,0.3)]'
                            : 'right-0 bg-gradient-to-r from-[#e11d48] to-[#f43f5e] shadow-[0_0_8px_rgba(244,63,94,0.3)]'}`}
                          style={{ width: `${Math.max(1.5, Math.min(100, row.graphPercent))}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="rtx-exposure-account-bar">
          <span className="rtx-exposure-account-metric"><span className="rtx-exposure-account-label">{tr('Balance:')}</span><span className="rtx-exposure-account-value">{formatAccountMetric(accountBalance)}</span></span>
          <span className="rtx-exposure-account-metric"><span className="rtx-exposure-account-label">{tr('Equity:')}</span><span className="rtx-exposure-account-value">{formatAccountMetric(accountEquity)}</span></span>
          <span className="rtx-exposure-account-metric"><span className="rtx-exposure-account-label">{tr('Margin:')}</span><span className="rtx-exposure-account-value">{formatAccountMetric(accountMargin)}</span></span>
          <span className="rtx-exposure-account-metric"><span className="rtx-exposure-account-label">{tr('Free margin:')}</span><span className="rtx-exposure-account-value">{formatAccountMetric(accountFreeMargin)}</span></span>
          <span className="rtx-exposure-account-metric">
            <span className="rtx-exposure-account-label">{tr('Level:')}</span>
            <span className="rtx-exposure-account-value">{accountMarginLevel !== null ? `${accountMarginLevel.toFixed(2)}%` : METRIC_UNAVAILABLE}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
