# ⚡ Last Symbol Trader — MT5 Custom Trading Panel

**One-click BUY/SELL that always trades the last used currency pair**, regardless of which chart is active. No more wrong-symbol mistakes.

---

## 📦 What's Included

| File                      | Description                                                                      |
| ------------------------- | -------------------------------------------------------------------------------- |
| `LastSymbolTrader.mq5`    | **Basic** — Floating BUY LAST / SELL LAST buttons, last-symbol tracking          |
| `LastSymbolTraderPro.mq5` | **Advanced** — Risk-based lots, auto SL/TP (fixed or ATR), hotkeys, account info |

---

## 🔧 Installation

### Step 1: Locate your MT5 Data Folder

1. Open MetaTrader 5
2. Go to **File → Open Data Folder**
3. Navigate to `MQL5\Experts\`

### Step 2: Copy the EA Files

Copy `LastSymbolTrader.mq5` (or `LastSymbolTraderPro.mq5`) into the `MQL5\Experts\` folder.

```
MQL5/
└── Experts/
    ├── LastSymbolTrader.mq5       ← Basic version
    └── LastSymbolTraderPro.mq5    ← Advanced version
```

### Step 3: Compile

1. Open **MetaEditor** (F4 from MT5, or double-click the `.mq5` file)
2. Click **Compile** (F7)
3. Ensure **0 errors** in the output — warnings about Unicode characters are safe to ignore

### Step 4: Enable Algo Trading

1. In MT5, go to **Tools → Options → Expert Advisors**
2. Check ✅ **Allow Algorithmic Trading**
3. Click **OK**

### Step 5: Attach to Chart

1. In the **Navigator** panel (Ctrl+N), expand **Expert Advisors**
2. Drag `LastSymbolTrader` (or `LastSymbolTraderPro`) onto **any chart**
3. In the EA settings dialog:
   - Check ✅ **Allow Algo Trading**
   - Configure inputs if desired
4. Click **OK**
5. The panel should appear on the chart

> ⚠️ **Important**: You can attach this EA to **multiple charts** — all instances share the same last-traded symbol via a common file.

---

## 🚀 How to Use

### Basic Version (`LastSymbolTrader`)

1. **Trade normally** on any chart — the EA automatically detects your trades
2. The panel shows `Last: EURUSD` (or whatever you traded last)
3. **Switch to any chart** and click:
   - **BUY LAST** → Opens a BUY on the last traded symbol
   - **SELL LAST** → Opens a SELL on the last traded symbol
   - **CLOSE LAST POSITIONS** → Closes all positions on that symbol

### Advanced Version (`LastSymbolTraderPro`)

Everything above, plus:

| Feature             | How it works                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------- |
| **Risk-based lots** | Set `RiskPercent = 1.0` → EA calculates lot size so you risk exactly 1% of balance per trade |
| **Auto SL/TP**      | Fixed pips (default 30/60) or ATR-based (1.5x ATR for SL, 3x ATR for TP)                     |
| **Hotkeys**         | Press `B` = Buy, `S` = Sell, `X` = Close (chart must be active)                              |
| **Close All**       | Separate button to close ALL positions across all symbols                                    |
| **Live info**       | Shows Balance, Equity, P&L, Spread, BID/ASK in real-time                                     |

---

## ⚙️ Input Parameters

### Basic Version

| Parameter             | Default    | Description                    |
| --------------------- | ---------- | ------------------------------ |
| `LotSize`             | 0.01       | Fixed lot size for all trades  |
| `Slippage`            | 10         | Max allowed slippage (points)  |
| `MagicNumber`         | 202603     | Unique ID for this EA's trades |
| `BuyColor`            | DodgerBlue | BUY button color               |
| `SellColor`           | Crimson    | SELL button color              |
| `XOffset` / `YOffset` | 20 / 80    | Panel position on chart        |

### Advanced Version (additional)

| Parameter        | Default | Description                       |
| ---------------- | ------- | --------------------------------- |
| `UseRiskPercent` | true    | Enable risk-based lot calculation |
| `RiskPercent`    | 1.0     | % of balance to risk per trade    |
| `MaxLotCap`      | 5.0     | Maximum lot size safety cap       |
| `AutoSLTP`       | true    | Enable automatic SL/TP            |
| `SLMode`         | 0       | 0 = Fixed Pips, 1 = ATR-Based     |
| `SLPips`         | 30      | SL distance in pips (fixed mode)  |
| `TPPips`         | 60      | TP distance in pips (fixed mode)  |
| `ATRMultSL`      | 1.5     | ATR multiplier for SL (ATR mode)  |
| `ATRMultTP`      | 3.0     | ATR multiplier for TP (ATR mode)  |
| `ATRPeriod`      | 14      | ATR indicator period              |
| `EnableHotkeys`  | true    | Enable keyboard shortcuts         |

---

## 🛡️ Safety Notes

1. **Always test on a DEMO account first**
2. The EA uses `FILE_COMMON` for cross-chart communication — this is the standard MT5 approach
3. The `MagicNumber` helps identify this EA's trades vs. manual/other EA trades
4. The `MaxLotCap` prevents accidentally opening huge positions in risk mode
5. If the EA is removed from all charts, the last symbol file persists in `MQL5\Files\Common\last_symbol.txt`

---

## ❓ Troubleshooting

| Issue                    | Solution                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| Buttons don't appear     | Ensure EA is attached and Algo Trading is enabled (green icon in toolbar)                  |
| "Trade failed" errors    | Check if the symbol is available in Market Watch, verify lot sizes                         |
| Last symbol not updating | Ensure `OnTradeTransaction` is working — check the Experts tab for logs                    |
| Panel in wrong position  | Adjust `XOffset` / `YOffset` in EA inputs                                                  |
| Hotkeys not working      | Click on the chart first to make it active, ensure `EnableHotkeys = true`                  |
| Compilation errors       | Make sure you're using MetaEditor for MQL5 (not MQL4), check the `Trade\Trade.mqh` include |

---

## 📁 How Cross-Chart Tracking Works

```
Chart 1 (EURUSD)          Chart 2 (GBPUSD)          Chart 3 (USDJPY)
    EA Instance               EA Instance               EA Instance
        │                         │                         │
        │  OnTradeTransaction()   │                         │
        │  detects EURUSD trade   │                         │
        ▼                         │                         │
   Writes "EURUSD" ──────► last_symbol.txt ◄──── Reads file
   to common file           (shared storage)     every 500ms
                                  │
                                  ▼
                         All panels show:
                         "Last: EURUSD"
                         BUY/SELL → EURUSD
```

All EA instances read the shared file every 500ms, so the last symbol updates across all charts within half a second.
