import { lazy, Suspense, useEffect, useState } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { useAppStore, type Position } from '../store/useAppStore';
import {
  CHART_POSITION_MODIFY_EVENT,
  resolveChartPositionModifyTarget,
  type ChartPositionModifyDetail,
} from '../utils/chartTradeControls';
import {
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
  onCommittedBrokerAccountSessionScopeChange,
} from '../services/brokerSession';

const LazyModifyPositionDialog = lazy(() => import('./ModifyPositionDialog').then(module => ({
  default: module.ModifyPositionDialog,
})));

type ChartModifyPositionDialogHostProps = {
  onClosePosition: (id: number) => Promise<boolean> | boolean | void;
  resolveAllowedSymbol: (symbol: unknown) => string;
};

type ActiveModifyPosition = {
  position: Position & {
    orderType?: string;
    limitPrice?: number | null;
    expiry?: number | null;
    timeInForce?: 'GTC' | 'DAY' | 'GTD';
    stateVersion?: number;
  };
  kind: 'position' | 'pending-order';
  sessionScope: string;
};

const samePositionIdentity = (position: Position, ticket: number, symbol: string): boolean => (
  Number(position.id) === ticket
  && String(position.symbol).trim().toUpperCase() === symbol.trim().toUpperCase()
);

/**
 * Persistent chart-to-dialog bridge. It stays mounted when Toolbox is closed,
 * while keeping dialog state out of App so opening it does not repaint the
 * whole terminal shell.
 */
export function ChartModifyPositionDialogHost({
  onClosePosition,
  resolveAllowedSymbol,
}: ChartModifyPositionDialogHostProps) {
  const [activeModifyPosition, setActiveModifyPosition] = useState<ActiveModifyPosition | null>(null);
  const position = activeModifyPosition?.position ?? null;

  useEffect(() => {
    const handleChartPositionModify = (event: Event) => {
      const sessionScope = getCommittedBrokerAccountSessionScopeKey(
        getCommittedBrokerAccountSessionScope(),
      );
      const detail = (event as CustomEvent<ChartPositionModifyDetail>).detail;
      if (detail?.kind === 'pending-order') {
        const rawOrders = (useAppStore.getState().orders ?? []) as unknown as Array<Record<string, unknown>>;
        const ticket = Number(detail.ticket);
        const symbol = String(detail.symbol ?? '').trim().toUpperCase();
        if (!Number.isSafeInteger(ticket) || ticket <= 0 || !symbol || detail.sessionScope !== sessionScope) return;
        const matchedOrder = rawOrders.find((ord) => (
          Number(ord.ticket ?? ord.id) === ticket
          && String(ord.symbol ?? '').trim().toUpperCase() === symbol
        ));
        if (!matchedOrder || !resolveAllowedSymbol(matchedOrder.symbol)) return;
        const orderType = String(matchedOrder.type ?? matchedOrder.orderType ?? '').trim();
        const side: 'BUY' | 'SELL' = String(matchedOrder.side ?? orderType).toUpperCase().includes('SELL') ? 'SELL' : 'BUY';
        const expiry = Number(matchedOrder.time_expiry ?? matchedOrder.expiry ?? 0) || null;
        setActiveModifyPosition({
          kind: 'pending-order',
          sessionScope,
          position: {
            id: ticket,
            symbol: String(matchedOrder.symbol ?? symbol),
            side,
            orderType,
            volume: Number(matchedOrder.volume ?? matchedOrder.quantity ?? 0) || 0,
            openPrice: Number(matchedOrder.price ?? matchedOrder.price_trigger ?? 0) || 0,
            limitPrice: Number(matchedOrder.price_limit ?? 0) || null,
            currentPrice: Number(matchedOrder.price_current ?? matchedOrder.price ?? 0) || 0,
            sl: Number(matchedOrder.price_sl ?? matchedOrder.sl ?? 0) || 0,
            tp: Number(matchedOrder.price_tp ?? matchedOrder.tp ?? 0) || 0,
            expiry,
            timeInForce: expiry ? 'GTD' : 'GTC',
            comment: typeof matchedOrder.comment === 'string' ? matchedOrder.comment : undefined,
            profit: 0,
            swap: 0,
            commission: 0,
            openTime: '',
          } as ActiveModifyPosition['position'],
        });
        return;
      }
      const target = resolveChartPositionModifyTarget(
        detail,
        sessionScope,
        useAppStore.getState().positions as Position[],
      );
      if (!target || !resolveAllowedSymbol(target.symbol)) return;
      setActiveModifyPosition({ position: target, kind: 'position', sessionScope });
    };

    window.addEventListener(CHART_POSITION_MODIFY_EVENT, handleChartPositionModify);
    return () => window.removeEventListener(CHART_POSITION_MODIFY_EVENT, handleChartPositionModify);
  }, [resolveAllowedSymbol]);

  useEffect(() => onCommittedBrokerAccountSessionScopeChange(() => {
    setActiveModifyPosition(null);
  }), []);

  useEffect(() => {
    if (!position) return;
    const ticket = Number(position.id);
    const symbol = position.symbol;
    return useAppStore.subscribe(state => {
      if (activeModifyPosition?.kind === 'pending-order') {
        const rawOrders = (state.orders ?? []) as unknown as Array<Record<string, unknown>>;
        const stillOpen = rawOrders.some(candidate => (
          Number(candidate.ticket ?? candidate.id) === ticket
          && String(candidate.symbol ?? '').trim().toUpperCase() === symbol.trim().toUpperCase()
        ));
        if (!stillOpen) {
          setActiveModifyPosition(current => (
            current && samePositionIdentity(current.position, ticket, symbol) ? null : current
          ));
        }
        return;
      }
      const stillOpen = (state.positions as Position[]).some(candidate => (
        samePositionIdentity(candidate, ticket, symbol)
      ));
      if (!stillOpen) {
        setActiveModifyPosition(current => (
          current && samePositionIdentity(current.position, ticket, symbol) ? null : current
        ));
      }
    });
  }, [activeModifyPosition?.kind, position]);

  if (!position || !activeModifyPosition) return null;

  return (
    <ErrorBoundary label="Modify Position">
      <Suspense fallback={null}>
        <LazyModifyPositionDialog
          isOpen
          kind={activeModifyPosition.kind}
          onClosePosition={onClosePosition}
          position={position}
          onClose={(modifiedSl?: number, modifiedTp?: number, modifiedComment?: string) => {
            const closingContext = activeModifyPosition;
            const currentSessionScope = getCommittedBrokerAccountSessionScopeKey(
              getCommittedBrokerAccountSessionScope(),
            );
            if (
              closingContext.sessionScope === currentSessionScope
              && modifiedSl !== undefined
              && modifiedTp !== undefined
            ) {
              window.dispatchEvent(new CustomEvent('rtx:trade-modified', {
                detail: {
                  id: position.id,
                  symbol: position.symbol,
                  sl: modifiedSl,
                  tp: modifiedTp,
                  comment: modifiedComment,
                  sessionScope: closingContext.sessionScope,
                },
              }));
            }
            setActiveModifyPosition(current => current === closingContext ? null : current);
          }}
        />
      </Suspense>
    </ErrorBoundary>
  );
}
