import { useEffect, useState } from 'react';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import { formatBrokerServerTime, getBrokerServerNowMs } from '../../services/brokerServerClock';

const readClock = () => {
  const serverNowMs = getBrokerServerNowMs();
  const nowMs = serverNowMs ?? Date.now();
  return { nowMs, synced: serverNowMs !== null, ...formatBrokerServerTime(nowMs) };
};

// Kept separate so the title's ticking clock never re-renders the quote table.
export function MarketWatchServerClock({ variant = 'footer' }: { variant?: 'footer' | 'header' }) {
  const tr = useUiTranslation();
  const [clock, setClock] = useState(readClock);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(readClock()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (variant === 'header') {
    return (
      <span className="rtx-market-watch__title-clock" data-server-clock-synced={clock.synced}>
        <span>{tr('Market Watch')}: </span>
        <time dateTime={new Date(clock.nowMs).toISOString()} title={`${tr('Server')} (${clock.zoneLabel})`} className="tabular-nums">
          {clock.time}
        </time>
      </span>
    );
  }
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
