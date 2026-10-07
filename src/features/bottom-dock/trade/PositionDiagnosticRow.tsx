import { useLayoutEffect, useRef, type ComponentPropsWithoutRef } from 'react';
import { markPositionDeliveryCommitted, positionDiagnosticGeneration, readPositionDeliveryEvidence } from '../../../services/positionDeliveryEvidence';
import { recordQuoteDiagnostic } from '../../../services/quoteDiagnostics';

type Props = ComponentPropsWithoutRef<'tr'> & {
  position: object;
  displayedPriceText?: string;
  displayedProfitText?: string;
  profitMode: string;
};
const number = (text?: string) => {
  if (!text || !/^-?\d[\d ,.]*$/.test(text)) return undefined;
  const value = Number(text.replace(/[ ,]/g, ''));
  return Number.isFinite(value) ? value : undefined;
};

/** Observes a real committed row; never schedules state or changes its values. */
export function PositionDiagnosticRow({ position, displayedPriceText, displayedProfitText, profitMode, ...props }: Props) {
  const ref = useRef<HTMLTableRowElement>(null);
  const retained = readPositionDeliveryEvidence(position);
  useLayoutEffect(() => {
    if (!retained || !ref.current?.isConnected || retained.positionSessionGeneration !== positionDiagnosticGeneration()) return;
    const domWriteMonoMs = performance.now();
    const reason = markPositionDeliveryCommitted(retained) ? 'first-retained-commit' : 'retained-row-redraw';
    const values = { ...retained, domWriteMonoMs, displayedPrice: number(displayedPriceText), displayedProfit: number(displayedProfitText), profitMode, reason };
    recordQuoteDiagnostic({ kind: 'position', phase: 'position-dom-commit', ...values, foreground: document.visibilityState === 'visible' });
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (!ref.current?.isConnected || readPositionDeliveryEvidence(position) !== retained) return;
        recordQuoteDiagnostic({ kind: 'position', phase: 'position-render-opportunity', ...values, frameOpportunityMonoMs: performance.now(), foreground: document.visibilityState === 'visible' });
      });
    });
    return () => { cancelAnimationFrame(first); if (second) cancelAnimationFrame(second); };
  }, [retained, displayedPriceText, displayedProfitText, profitMode]);
  return <tr {...props} ref={ref} data-position-delivery={retained?.positionDeliveryId} data-position-session={retained?.positionSessionGeneration} />;
}
