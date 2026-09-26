import { useEffect, useState } from 'react';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import { formatBrokerServerTime, getBrokerServerNowMs } from '../../services/brokerServerClock';

const readClock = () => {
  const serverNowMs = getBrokerServerNowMs();
  const nowMs = serverNowMs ?? Date.now();
  return { nowMs, synced: serverNowMs !== null, ...formatBrokerServerTime(nowMs) };
};

// Ticking server clock of the active broker, shown beneath the Market Watch
// symbol list. Kept as its own component so the once-per-second update never
// re-renders the quote table.
export function MarketWatchServerClock() {
  const tr = useUiTranslation();
  const [clock, setClock] = useState(readClock);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(readClock()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div
      className="rtx-market-watch__server-clock flex h-6 shrink-0 items-center justify-start gap-1.5 border-t px-2 border-[#2a3342] text-[12px] leading-none text-zinc-300 select-none [.rtx-advanced-view_&]:border-zinc-400 [.rtx-advanced-view_&]:text-black"
      data-server-clock-synced={clock.synced}
    >
      <span className="text-zinc-500 [.rtx-advanced-view_&]:text-zinc-600">{tr('Server')}</span>
      <time dateTime={new Date(clock.nowMs).toISOString()} title={`${tr('Server')} (${clock.zoneLabel})`} className="font-mono tabular-nums">
        {clock.time} {clock.zoneLabel}
      </time>
    </div>
  );
}
