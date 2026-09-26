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
  position: Position;
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
      const target = resolveChartPositionModifyTarget(
        (event as CustomEvent<ChartPositionModifyDetail>).detail,
        sessionScope,
        useAppStore.getState().positions as Position[],
      );
      if (!target || !resolveAllowedSymbol(target.symbol)) return;
      setActiveModifyPosition({ position: target, sessionScope });
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
      const stillOpen = (state.positions as Position[]).some(candidate => (
        samePositionIdentity(candidate, ticket, symbol)
      ));
      if (!stillOpen) {
        setActiveModifyPosition(current => (
          current && samePositionIdentity(current.position, ticket, symbol) ? null : current
        ));
      }
    });
  }, [position]);

  if (!position || !activeModifyPosition) return null;

  return (
    <ErrorBoundary label="Modify Position">
      <Suspense fallback={null}>
        <LazyModifyPositionDialog
          isOpen
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
