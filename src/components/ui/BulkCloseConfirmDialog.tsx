import React, { useEffect, useRef, useMemo } from 'react';
import { useBulkCloseConfirmStore } from '../../store/useBulkCloseConfirmStore';
import { useUiTranslation } from '../../hooks/useUiTranslation';

const MAX_PREVIEW_ROWS = 10;

export function BulkCloseConfirmDialog() {
    const tr = useUiTranslation();
    const {
        isOpen,
        type,
        symbol,
        positions,
        combinedPnL,
        onConfirm,
        onCancel,
    } = useBulkCloseConfirmStore();

    const confirmBtnRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    // Sort positions by P&L descending
    const sortedPositions = useMemo(() =>
        [...positions].sort((a, b) => b.pnl - a.pnl),
        [positions],
    );

    const visiblePositions = sortedPositions.slice(0, MAX_PREVIEW_ROWS);
    const hiddenCount = Math.max(0, sortedPositions.length - MAX_PREVIEW_ROWS);

    const profitableCount = positions.filter(p => p.pnl > 0).length;
    const losingCount = positions.filter(p => p.pnl < 0).length;
    const breakEvenCount = positions.filter(p => p.pnl === 0).length;

    // Keyboard handling
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                onConfirm();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isOpen, onConfirm, onCancel]);

    // Focus trap
    useEffect(() => {
        if (isOpen && confirmBtnRef.current) {
            confirmBtnRef.current.focus();
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const modeLabel = type === 'ALL'
        ? tr('Close All Positions')
        : type === 'WINNERS'
            ? tr('Close In-Profit Positions')
            : tr('Close In-Loss Positions');

    const pnlSign = combinedPnL >= 0 ? '+' : '';
    const pnlFormatted = `${pnlSign}${combinedPnL.toFixed(2)}`;
    const pnlTone = combinedPnL >= 0 ? 'profit' : 'loss';

    return (
        <div
            className="rtx-bulk-close-backdrop"
            onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
            onContextMenuCapture={(e) => { e.stopPropagation(); e.preventDefault(); }}
            onContextMenu={(e) => e.stopPropagation()}
        >
            <div ref={dialogRef} className="rtx-bulk-close-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-close-title">

                {/* ─── Header ─── */}
                <div className="rtx-bulk-close-dialog__header">
                    <div className="rtx-bulk-close-dialog__header-left">
                        <span id="bulk-close-title" className="rtx-bulk-close-dialog__title">{modeLabel}</span>
                        {symbol && (
                            <span className="rtx-bulk-close-dialog__symbol-badge">{symbol}</span>
                        )}
                    </div>
                    <button onClick={onCancel} className="rtx-bulk-close-dialog__close-btn" aria-label="Close dialog">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1L13 13M1 13L13 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                    </button>
                </div>

                {/* ─── Summary Stats ─── */}
                <div className="rtx-bulk-close-dialog__stats">
                    <div className="rtx-bulk-close-dialog__stat">
                        <span className="rtx-bulk-close-dialog__stat-label">{tr('Positions')}</span>
                        <span className="rtx-bulk-close-dialog__stat-value">{positions.length}</span>
                    </div>
                    <div className="rtx-bulk-close-dialog__stat-divider" />
                    <div className="rtx-bulk-close-dialog__stat">
                        <span className="rtx-bulk-close-dialog__stat-label">{tr('Combined P&L')}</span>
                        <span className={`rtx-bulk-close-dialog__stat-value rtx-bulk-close-dialog__stat-value--${pnlTone}`}>
                            {pnlFormatted}
                        </span>
                    </div>
                    <div className="rtx-bulk-close-dialog__stat-divider" />
                    <div className="rtx-bulk-close-dialog__stat">
                        <span className="rtx-bulk-close-dialog__stat-label">{tr('Breakdown')}</span>
                        <span className="rtx-bulk-close-dialog__stat-value rtx-bulk-close-dialog__breakdown">
                            <span className="rtx-bulk-close-dialog__breakdown-item rtx-bulk-close-dialog__breakdown-item--profit">{profitableCount} ↑</span>
                            <span className="rtx-bulk-close-dialog__breakdown-sep">·</span>
                            <span className="rtx-bulk-close-dialog__breakdown-item rtx-bulk-close-dialog__breakdown-item--loss">{losingCount} ↓</span>
                            {breakEvenCount > 0 && (
                                <>
                                    <span className="rtx-bulk-close-dialog__breakdown-sep">·</span>
                                    <span className="rtx-bulk-close-dialog__breakdown-item rtx-bulk-close-dialog__breakdown-item--neutral">{breakEvenCount} ―</span>
                                </>
                            )}
                        </span>
                    </div>
                </div>

                {/* ─── Position Preview Table ─── */}
                <div className="rtx-bulk-close-dialog__table-wrapper">
                    <table className="rtx-bulk-close-dialog__table">
                        <thead>
                            <tr>
                                <th>{tr('Ticket')}</th>
                                <th>{tr('Symbol')}</th>
                                <th>{tr('Direction')}</th>
                                <th className="rtx-bulk-close-dialog__th-right">{tr('Volume')}</th>
                                <th className="rtx-bulk-close-dialog__th-right">{tr('Open Price')}</th>
                                <th className="rtx-bulk-close-dialog__th-right">{tr('P&L')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visiblePositions.map((pos) => {
                                const rowPnlTone = pos.pnl > 0 ? 'profit' : pos.pnl < 0 ? 'loss' : 'neutral';
                                const rowPnlSign = pos.pnl > 0 ? '+' : '';
                                return (
                                    <tr key={pos.id} className="rtx-bulk-close-dialog__row">
                                        <td className="rtx-bulk-close-dialog__cell-ticket">#{pos.id}</td>
                                        <td className="rtx-bulk-close-dialog__cell-symbol">{pos.symbol}</td>
                                        <td>
                                            <span className={`rtx-bulk-close-dialog__direction rtx-bulk-close-dialog__direction--${pos.side.toLowerCase()}`}>
                                                {pos.side}
                                            </span>
                                        </td>
                                        <td className="rtx-bulk-close-dialog__cell-right">{pos.volume.toFixed(2)}</td>
                                        <td className="rtx-bulk-close-dialog__cell-right">{pos.openPrice.toFixed(pos.openPrice >= 100 ? 2 : 5)}</td>
                                        <td className={`rtx-bulk-close-dialog__cell-right rtx-bulk-close-dialog__cell-pnl rtx-bulk-close-dialog__cell-pnl--${rowPnlTone}`}>
                                            {rowPnlSign}{pos.pnl.toFixed(2)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {hiddenCount > 0 && (
                        <div className="rtx-bulk-close-dialog__overflow-note">
                            +{hiddenCount} more position{hiddenCount > 1 ? 's' : ''} not shown
                        </div>
                    )}
                </div>

                {/* ─── Footer ─── */}
                <div className="rtx-bulk-close-dialog__footer">
                    <button onClick={onCancel} className="rtx-bulk-close-dialog__btn-cancel">
                        {tr('Cancel')}
                    </button>
                    <button
                        ref={confirmBtnRef}
                        onClick={onConfirm}
                        className="rtx-bulk-close-dialog__btn-confirm"
                    >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="rtx-bulk-close-dialog__btn-icon">
                            <path d="M1 7H13M7 1L13 7L7 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {tr('Close')} {positions.length} {tr('Positions')}
                    </button>
                </div>
            </div>
        </div>
    );
}
