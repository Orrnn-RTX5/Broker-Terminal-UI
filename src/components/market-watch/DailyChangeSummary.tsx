import { resolveDailyChangeDisplayDigits } from '../../services/dailyChangePriceModeRegistry';
import { useTick } from '../../store/useAppStore';
import { resolveMarketWatchDisplayMetadata, useMarketWatchDisplayMetadata } from '../../store/useMarketWatchDisplayMetadataStore';
import { formatDailyChange } from '../../utils/dailyChange';
import { dailyChangeDescription } from '../../utils/dailyChangeSession';
import { useUiTranslation } from '../../hooks/useUiTranslation';

/** Shared symbol-price header summary; uses the existing per-symbol subscription. */
export function DailyChangeSummary({ symbol, digits }: { symbol: string; digits?: number | null }) {
  const tr = useUiTranslation();
  const tick = useTick(symbol);
  const metadata = useMarketWatchDisplayMetadata(symbol);
  const display = resolveMarketWatchDisplayMetadata(tick, metadata);
  const direction = display.dailyChangePrice ?? display.dailyChange ?? 0;
  return <span aria-label={tr('Daily Change')} title={dailyChangeDescription(display.daily)}
    data-status={display.daily?.status ?? 'unavailable'}
    style={{ display: 'inline-flex', gap: 6, fontVariantNumeric: 'tabular-nums', fontSize: 12, color: direction > 0 ? 'var(--color-profit, #4597ff)' : direction < 0 ? 'var(--color-loss, #ff5858)' : 'var(--text-secondary)' }}>
    <span>{formatDailyChange(display.dailyChangePrice, resolveDailyChangeDisplayDigits(symbol, tick?.digits ?? digits))}</span>
    <span>({formatDailyChange(display.dailyChange, 2, true)})</span>
    {display.daily?.status && display.daily.status !== 'live' && <span>{tr(display.daily.status)}</span>}
  </span>;
}
