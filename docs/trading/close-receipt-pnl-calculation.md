# Close Receipt P&L: what it calculates

Checked 2026-09-25 on branch `feature/ui-updates-and-test-fixes` (uncommitted changes).
This is a review note. No code was changed. Line numbers are from that snapshot and may drift.

## Where the receipt comes from

When positions are closed (one position, Close All, Close In-Profit or Close In-Loss), the terminal shows a close receipt:

| Piece | File |
|---|---|
| Row capture (the state of each position when its close was sent) | `buildPositionCloseReportRows` in [src/App.tsx](../../src/App.tsx) (~L658-677) |
| P&L source per position | `backendCloseProfit` → `readBackendPositionProfit` in [src/components/BottomDock.trade.ts](../../src/components/BottomDock.trade.ts) (L123-126) |
| Close price per position | `getTradeExitPriceFromQuote` in [src/App.tsx](../../src/App.tsx) (~L602-621) |
| Totals and counts | `buildPositionCloseReport` in [src/components/notifications/positionCloseReport.ts](../../src/components/notifications/positionCloseReport.ts) (L49-86) |
| Display, tone and labels | [src/components/notifications/ActionFeedbackToast.tsx](../../src/components/notifications/ActionFeedbackToast.tsx) |

## What each number is

| Receipt field | How it is calculated |
|---|---|
| **Row P&L** | The backend position `profit` from the **last position update received before the close was sent**. It is not recalculated locally. |
| **Row Close price** | The **live quote at the moment the close was sent**: the bid for a BUY and the ask for a SELL. If there is no quote, it falls back to the position's `currentPrice`. It is **not** the fill price. |
| **Row Open price** | `position.openPrice` |
| **Realized P&L** (top) and **Est. realized P&L** (summary) | The same number: `sum(row.profit)` over rows with status `closed` whose profit is a finite number. It is `null` (shown as "—") when no closed row has a known profit. |
| **Volume** | `sum(row.volume)` over rows with status `closed` |
| **Closed** | Number of confirmed tickets |
| **Requested** | Confirmed tickets + failed tickets |
| **Profit / Loss / Breakeven badge and colour** | Sign of the total. Close In-Loss is always shown as a loss and Close In-Profit always as a profit. A partial close shows as a warning and a failed close as an error. |

In short:

```
Receipt P&L = Σ backend position.profit   (closed rows only, at the moment the close was sent)
```

## Verified correct

- Closed and requested counts: failed closes count as requested but not as closed.
- Volume and P&L: only closed positions are added; rejected ones are left out.
- Close price side: a BUY closes at the bid and a SELL at the ask.
- Sign, 2-decimal rounding and profit/loss colour follow the total.
- Bulk closes: positions found through the backend fallback also get receipt rows (`onCandidatesStarted` is called for both the local and the backend candidates in [src/services/localFirstCloseCoordinator.ts](../../src/services/localFirstCloseCoordinator.ts)), so the counts and the table match.
- Existing tests pass: `ActionFeedbackToast.test.tsx`, `backendAccountMetrics.test.ts` and `positionStream.test.ts`, 28 of 28.

## Accuracy gaps

### 1. Swap and commission are not included (main issue)

The backend position `profit` **excludes swap and commission**. The code already documents this and adds them back for the account's floating P/L ([BottomDock.trade.ts](../../src/components/BottomDock.trade.ts) L224-240):

```
floating P/L = Σ (profit + swap + commission)
```

The close receipt adds up `profit` only.

**Example**

| | Value |
|---|---|
| profit | +25.00 |
| swap | −3.20 |
| commission | −7.00 |
| **Receipt shows** | **+25.00** |
| Actual balance change | about **+14.80** |

As a result, the receipt disagrees with the floating P/L the user saw just before closing.

### 2. It is an estimate from before the fill, not the actual fill

- The P&L is the last backend profit update received **before** the close was sent.
- The close price is the live quote at the moment the close was sent.
- Those two can come from slightly different moments. The real fill can also differ by slippage.
- The summary row says **"Est. realized P&L"**, but the large number at the top says plain **"Realized P&L"** ([ActionFeedbackToast.tsx](../../src/components/notifications/ActionFeedbackToast.tsx) L183 and L212). That claims more precision than the number has.

### 3. Missing profits are silently dropped

If some closed rows have no backend profit (for example, a position that was just opened and has `hasBackendProfit === false`), the total adds up only the rows that do. The affected row shows "—", but the total gives no sign that it is incomplete.

### 4. The same number appears twice

The top value and the summary total are the same figure under two different labels.

## Recommendation

1. Add each closed position's `swap` and `commission` to its row P&L (the same rule as `applyLivePositionProfit`), so the receipt matches the floating P/L the user saw.
2. Label the top value **"Est. realized P&L"** as well, or show it only once.
3. Mark the total as incomplete (for example "≥" or a footnote) when any closed row has an unknown profit.
4. For the exact figure, read the closing deals from history after the close (deal profit + swap + commission at the actual fill price).
