//+------------------------------------------------------------------+
//|                                        LastSymbolTraderPro.mq5   |
//|                    Advanced Last Symbol One-Click Trading Panel   |
//|                   Pro Version v1.0 — Risk Mgmt + Auto SL/TP     |
//+------------------------------------------------------------------+
#property copyright   "LastSymbolTraderPro"
#property version     "1.00"
#property description "Professional one-click trading panel."
#property description "Risk-based lot sizing, auto SL/TP, hotkeys."
#property description "Always trades the last used symbol across all charts."

#include <Trade\Trade.mqh>

//--- Input Parameters
input group "═══ Trade Settings ═══"
input double   InpLotSize         = 0.01;      // Default Lot Size (if RiskMode=Fixed)
input int      InpSlippage        = 10;        // Max Slippage (points)
input ulong    InpMagicNumber     = 202603;    // Magic Number
input int      InpDeviation       = 10;        // Deviation (points)

input group "═══ Risk Management ═══"
input bool     InpUseRiskPercent  = true;      // Use Risk-Based Lot Sizing
input double   InpRiskPercent     = 1.0;       // Risk % of Balance per Trade
input double   InpMaxLotCap       = 5.0;       // Maximum Lot Cap

input group "═══ Auto SL/TP ═══"
input bool     InpAutoSLTP        = true;      // Enable Auto SL/TP
input int      InpSLMode          = 0;         // SL Mode (0=Fixed Pips, 1=ATR-Based)
input int      InpSLPips          = 30;        // SL Distance (Pips) [Fixed Mode]
input int      InpTPPips          = 60;        // TP Distance (Pips) [Fixed Mode]
input double   InpATRMultSL      = 1.5;       // ATR Multiplier for SL [ATR Mode]
input double   InpATRMultTP      = 3.0;       // ATR Multiplier for TP [ATR Mode]
input int      InpATRPeriod       = 14;        // ATR Period [ATR Mode]

input group "═══ Hotkeys ═══"
input bool     InpEnableHotkeys   = true;      // Enable Hotkeys
// B = Buy Last | S = Sell Last | X = Close Last

input group "═══ Panel Settings ═══"
input color    InpBuyColor        = C'0,150,136';   // Buy Button Color (Teal)
input color    InpSellColor       = C'211,47,47';   // Sell Button Color (Red)
input color    InpPanelBg         = C'25,25,30';    // Panel Background
input color    InpHeaderBg        = C'35,35,45';    // Header Background
input color    InpTextColor       = C'220,220,220'; // Text Color
input color    InpAccentColor     = C'255,193,7';   // Accent Color (Gold)
input int      InpXOffset         = 20;             // X Offset
input int      InpYOffset         = 60;             // Y Offset

//--- Constants
#define FILE_NAME          "last_symbol.txt"
#define PREFIX             "LSTP_"

//--- Object Names
#define OBJ_PANEL_BG       PREFIX + "PanelBg"
#define OBJ_HEADER         PREFIX + "Header"
#define OBJ_TITLE          PREFIX + "Title"
#define OBJ_SYMBOL_LBL     PREFIX + "SymLbl"
#define OBJ_SYMBOL_VAL     PREFIX + "SymVal"
#define OBJ_SPREAD_LBL     PREFIX + "SpreadLbl"
#define OBJ_BID_VAL        PREFIX + "BidVal"
#define OBJ_ASK_VAL        PREFIX + "AskVal"
#define OBJ_LOT_LBL        PREFIX + "LotLbl"
#define OBJ_LOT_VAL        PREFIX + "LotVal"
#define OBJ_SL_LBL         PREFIX + "SLLbl"
#define OBJ_TP_LBL         PREFIX + "TPLbl"
#define OBJ_RISK_LBL       PREFIX + "RiskLbl"
#define OBJ_BALANCE_LBL    PREFIX + "BalLbl"
#define OBJ_EQUITY_LBL     PREFIX + "EqLbl"
#define OBJ_PNL_LBL        PREFIX + "PnlLbl"
#define OBJ_BTN_BUY        PREFIX + "BtnBuy"
#define OBJ_BTN_SELL       PREFIX + "BtnSell"
#define OBJ_BTN_CLOSE      PREFIX + "BtnClose"
#define OBJ_BTN_CLOSEALL   PREFIX + "BtnCloseAll"
#define OBJ_SEP1           PREFIX + "Sep1"
#define OBJ_SEP2           PREFIX + "Sep2"
#define OBJ_SEP3           PREFIX + "Sep3"
#define OBJ_SEP4           PREFIX + "Sep4"
#define OBJ_STATUS         PREFIX + "Status"
#define OBJ_HOTKEY_LBL     PREFIX + "HotkeyLbl"

//--- Global Variables
CTrade         trade;
string         g_lastSymbol    = "";
int            g_atrHandle     = INVALID_HANDLE;
string         g_atrSymbol     = "";

//+------------------------------------------------------------------+
//| Expert initialization                                              |
//+------------------------------------------------------------------+
int OnInit()
{
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(InpDeviation);
   trade.SetTypeFilling(ORDER_FILLING_IOC);

   g_lastSymbol = ReadLastSymbol();
   if(g_lastSymbol == "")
      g_lastSymbol = _Symbol;

   //--- Initialize ATR handle if needed
   if(InpAutoSLTP && InpSLMode == 1)
      InitATR(g_lastSymbol);

   CreatePanel();
   EventSetMillisecondTimer(500);

   if(InpEnableHotkeys)
      Print("Hotkeys enabled: B=Buy, S=Sell, X=Close");

   Print("LastSymbolTraderPro initialized. Last: ", g_lastSymbol);
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization                                             |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   ObjectsDeleteAll(0, PREFIX);
   EventKillTimer();
   if(g_atrHandle != INVALID_HANDLE)
      IndicatorRelease(g_atrHandle);
   Comment("");
}

//+------------------------------------------------------------------+
//| Tick handler                                                        |
//+------------------------------------------------------------------+
void OnTick()
{
   UpdatePanel();
}

//+------------------------------------------------------------------+
//| Timer handler                                                       |
//+------------------------------------------------------------------+
void OnTimer()
{
   string sym = ReadLastSymbol();
   if(sym != "" && sym != g_lastSymbol)
   {
      g_lastSymbol = sym;
      if(InpAutoSLTP && InpSLMode == 1)
         InitATR(g_lastSymbol);
   }
   UpdatePanel();
}

//+------------------------------------------------------------------+
//| Trade transaction — detect new trades across all charts            |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
{
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD)
   {
      ulong ticket = trans.deal;
      if(ticket > 0)
      {
         string dealSymbol = trans.symbol;
         ENUM_DEAL_TYPE dealType = (ENUM_DEAL_TYPE)trans.deal_type;

         if((dealType == DEAL_TYPE_BUY || dealType == DEAL_TYPE_SELL) && dealSymbol != "")
         {
            g_lastSymbol = dealSymbol;
            WriteLastSymbol(dealSymbol);
            if(InpAutoSLTP && InpSLMode == 1)
               InitATR(g_lastSymbol);
            UpdatePanel();
            Print("Symbol updated → ", dealSymbol);
         }
      }
   }

   if(trans.type == TRADE_TRANSACTION_ORDER_DELETE ||
      trans.type == TRADE_TRANSACTION_HISTORY_ADD)
   {
      if(request.symbol != "" && request.symbol != NULL &&
         request.action == TRADE_ACTION_DEAL)
      {
         g_lastSymbol = request.symbol;
         WriteLastSymbol(request.symbol);
         if(InpAutoSLTP && InpSLMode == 1)
            InitATR(g_lastSymbol);
         UpdatePanel();
      }
   }
}

//+------------------------------------------------------------------+
//| Chart event — buttons + hotkeys                                    |
//+------------------------------------------------------------------+
void OnChartEvent(const int id, const long &lparam,
                  const double &dparam, const string &sparam)
{
   //--- Button clicks
   if(id == CHARTEVENT_OBJECT_CLICK)
   {
      if(sparam == OBJ_BTN_BUY)
      {
         ObjectSetInteger(0, OBJ_BTN_BUY, OBJPROP_STATE, false);
         ExecuteBuy();
      }
      else if(sparam == OBJ_BTN_SELL)
      {
         ObjectSetInteger(0, OBJ_BTN_SELL, OBJPROP_STATE, false);
         ExecuteSell();
      }
      else if(sparam == OBJ_BTN_CLOSE)
      {
         ObjectSetInteger(0, OBJ_BTN_CLOSE, OBJPROP_STATE, false);
         CloseSymbolPositions(g_lastSymbol);
      }
      else if(sparam == OBJ_BTN_CLOSEALL)
      {
         ObjectSetInteger(0, OBJ_BTN_CLOSEALL, OBJPROP_STATE, false);
         CloseAllPositions();
      }
      ChartRedraw(0);
   }

   //--- Hotkey support
   if(InpEnableHotkeys && id == CHARTEVENT_KEYDOWN)
   {
      // B key = Buy
      if(lparam == 'B')
         ExecuteBuy();
      // S key = Sell
      else if(lparam == 'S')
         ExecuteSell();
      // X key = Close last symbol positions
      else if(lparam == 'X')
         CloseSymbolPositions(g_lastSymbol);
   }
}

//+------------------------------------------------------------------+
//| Calculate lot size based on risk                                   |
//+------------------------------------------------------------------+
double CalculateLotSize()
{
   if(!InpUseRiskPercent)
      return InpLotSize;

   if(g_lastSymbol == "")
      return InpLotSize;

   double balance    = AccountInfoDouble(ACCOUNT_BALANCE);
   double riskAmount = balance * InpRiskPercent / 100.0;

   //--- Calculate SL distance in price
   double slDistance = GetSLDistance();
   if(slDistance <= 0)
      return InpLotSize;

   //--- Get tick value and tick size
   double tickValue = SymbolInfoDouble(g_lastSymbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize  = SymbolInfoDouble(g_lastSymbol, SYMBOL_TRADE_TICK_SIZE);

   if(tickValue <= 0 || tickSize <= 0)
      return InpLotSize;

   //--- Calculate lot size
   double slTicks = slDistance / tickSize;
   double lot     = riskAmount / (slTicks * tickValue);

   //--- Normalize and clamp
   double lotStep = SymbolInfoDouble(g_lastSymbol, SYMBOL_VOLUME_STEP);
   double minLot  = SymbolInfoDouble(g_lastSymbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(g_lastSymbol, SYMBOL_VOLUME_MAX);

   lot = NormalizeLot(lot, lotStep);
   lot = MathMax(minLot, MathMin(MathMin(maxLot, InpMaxLotCap), lot));

   return lot;
}

//+------------------------------------------------------------------+
//| Get SL distance in price                                           |
//+------------------------------------------------------------------+
double GetSLDistance()
{
   if(g_lastSymbol == "")
      return 0;

   double point = SymbolInfoDouble(g_lastSymbol, SYMBOL_POINT);
   int digits   = (int)SymbolInfoInteger(g_lastSymbol, SYMBOL_DIGITS);

   //--- Fixed pips mode
   if(InpSLMode == 0)
   {
      // Convert pips to price distance
      // For 5/3 digit brokers, 1 pip = 10 points
      double pipSize = (digits == 3 || digits == 5) ? point * 10 : point;
      return InpSLPips * pipSize;
   }

   //--- ATR-based mode
   if(InpSLMode == 1)
   {
      double atrValue = GetATRValue();
      if(atrValue > 0)
         return atrValue * InpATRMultSL;
   }

   return InpSLPips * point * 10; // Fallback
}

//+------------------------------------------------------------------+
//| Get TP distance in price                                           |
//+------------------------------------------------------------------+
double GetTPDistance()
{
   if(g_lastSymbol == "")
      return 0;

   double point = SymbolInfoDouble(g_lastSymbol, SYMBOL_POINT);
   int digits   = (int)SymbolInfoInteger(g_lastSymbol, SYMBOL_DIGITS);

   if(InpSLMode == 0)
   {
      double pipSize = (digits == 3 || digits == 5) ? point * 10 : point;
      return InpTPPips * pipSize;
   }

   if(InpSLMode == 1)
   {
      double atrValue = GetATRValue();
      if(atrValue > 0)
         return atrValue * InpATRMultTP;
   }

   return InpTPPips * point * 10;
}

//+------------------------------------------------------------------+
//| Initialize ATR indicator for symbol                                |
//+------------------------------------------------------------------+
void InitATR(string symbol)
{
   if(g_atrHandle != INVALID_HANDLE && g_atrSymbol == symbol)
      return; // Already initialized for this symbol

   if(g_atrHandle != INVALID_HANDLE)
      IndicatorRelease(g_atrHandle);

   g_atrHandle = iATR(symbol, PERIOD_H1, InpATRPeriod);
   g_atrSymbol = symbol;

   if(g_atrHandle == INVALID_HANDLE)
      Print("Warning: Failed to create ATR for ", symbol);
}

//+------------------------------------------------------------------+
//| Get current ATR value                                              |
//+------------------------------------------------------------------+
double GetATRValue()
{
   if(g_atrHandle == INVALID_HANDLE)
      return 0;

   double atr[];
   if(CopyBuffer(g_atrHandle, 0, 0, 1, atr) <= 0)
      return 0;

   return atr[0];
}

//+------------------------------------------------------------------+
//| Execute BUY on last symbol                                         |
//+------------------------------------------------------------------+
void ExecuteBuy()
{
   if(g_lastSymbol == "")
   {
      Alert("No last traded symbol!");
      return;
   }

   if(!SymbolSelect(g_lastSymbol, true))
   {
      Alert("Cannot select: ", g_lastSymbol);
      return;
   }

   double ask = SymbolInfoDouble(g_lastSymbol, SYMBOL_ASK);
   if(ask == 0) { Alert("No ASK price for: ", g_lastSymbol); return; }

   double lot = CalculateLotSize();
   int digits = (int)SymbolInfoInteger(g_lastSymbol, SYMBOL_DIGITS);

   //--- Calculate SL/TP
   double sl = 0, tp = 0;
   if(InpAutoSLTP)
   {
      double slDist = GetSLDistance();
      double tpDist = GetTPDistance();
      if(slDist > 0) sl = NormalizeDouble(ask - slDist, digits);
      if(tpDist > 0) tp = NormalizeDouble(ask + tpDist, digits);
   }

   //--- Execute trade
   if(trade.Buy(lot, g_lastSymbol, ask, sl, tp, "LSTPro_Buy"))
   {
      Print("✓ BUY ", DoubleToString(lot, 2), " ", g_lastSymbol,
            " @ ", DoubleToString(ask, digits),
            " SL=", (sl > 0 ? DoubleToString(sl, digits) : "None"),
            " TP=", (tp > 0 ? DoubleToString(tp, digits) : "None"));
      FlashStatus("BUY FILLED ✓", clrLime);
   }
   else
   {
      string err = "BUY FAILED: " + trade.ResultComment();
      Alert(err);
      FlashStatus(err, clrRed);
   }
}

//+------------------------------------------------------------------+
//| Execute SELL on last symbol                                        |
//+------------------------------------------------------------------+
void ExecuteSell()
{
   if(g_lastSymbol == "")
   {
      Alert("No last traded symbol!");
      return;
   }

   if(!SymbolSelect(g_lastSymbol, true))
   {
      Alert("Cannot select: ", g_lastSymbol);
      return;
   }

   double bid = SymbolInfoDouble(g_lastSymbol, SYMBOL_BID);
   if(bid == 0) { Alert("No BID price for: ", g_lastSymbol); return; }

   double lot = CalculateLotSize();
   int digits = (int)SymbolInfoInteger(g_lastSymbol, SYMBOL_DIGITS);

   //--- Calculate SL/TP
   double sl = 0, tp = 0;
   if(InpAutoSLTP)
   {
      double slDist = GetSLDistance();
      double tpDist = GetTPDistance();
      if(slDist > 0) sl = NormalizeDouble(bid + slDist, digits);
      if(tpDist > 0) tp = NormalizeDouble(bid - tpDist, digits);
   }

   //--- Execute trade
   if(trade.Sell(lot, g_lastSymbol, bid, sl, tp, "LSTPro_Sell"))
   {
      Print("✓ SELL ", DoubleToString(lot, 2), " ", g_lastSymbol,
            " @ ", DoubleToString(bid, digits),
            " SL=", (sl > 0 ? DoubleToString(sl, digits) : "None"),
            " TP=", (tp > 0 ? DoubleToString(tp, digits) : "None"));
      FlashStatus("SELL FILLED ✓", clrLime);
   }
   else
   {
      string err = "SELL FAILED: " + trade.ResultComment();
      Alert(err);
      FlashStatus(err, clrRed);
   }
}

//+------------------------------------------------------------------+
//| Close positions for a specific symbol                              |
//+------------------------------------------------------------------+
void CloseSymbolPositions(string symbol)
{
   if(symbol == "") { Alert("No symbol!"); return; }

   int total = PositionsTotal();
   int closed = 0;
   for(int i = total - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket > 0 && PositionGetString(POSITION_SYMBOL) == symbol)
      {
         if(trade.PositionClose(ticket))
            closed++;
      }
   }
   Print(closed > 0 ? "✓ Closed " + IntegerToString(closed) + " on " + symbol
                     : "No positions on " + symbol);
   FlashStatus(closed > 0 ? "CLOSED " + IntegerToString(closed) + " ✓" : "Nothing to close", clrYellow);
}

//+------------------------------------------------------------------+
//| Close ALL positions                                                |
//+------------------------------------------------------------------+
void CloseAllPositions()
{
   int total = PositionsTotal();
   int closed = 0;
   for(int i = total - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket > 0)
      {
         if(trade.PositionClose(ticket))
            closed++;
      }
   }
   Print("Closed ALL: ", closed, " positions");
   FlashStatus("ALL CLOSED: " + IntegerToString(closed), clrYellow);
}

//+------------------------------------------------------------------+
//| Flash status message                                               |
//+------------------------------------------------------------------+
void FlashStatus(string msg, color clr)
{
   ObjectSetString(0, OBJ_STATUS, OBJPROP_TEXT, msg);
   ObjectSetInteger(0, OBJ_STATUS, OBJPROP_COLOR, clr);
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
//| Create the professional panel                                      |
//+------------------------------------------------------------------+
void CreatePanel()
{
   int x = InpXOffset;
   int y = InpYOffset;
   int W = 240;            // Panel width
   int pad = 10;           // Padding
   int row = 16;           // Row height
   int cy = y;             // Current Y position

   ENUM_BASE_CORNER corner = CORNER_LEFT_UPPER;

   //--- Panel Background
   CreateRect(OBJ_PANEL_BG, x, cy, W, 405, InpPanelBg);

   //--- Header
   CreateRect(OBJ_HEADER, x, cy, W, 32, InpHeaderBg);
   CreateLabel(OBJ_TITLE, x + pad, cy + 8, "⚡ LAST SYMBOL TRADER PRO",
               InpAccentColor, 10, "Segoe UI Semibold");
   cy += 38;

   //--- Last Symbol Section
   CreateLabel(OBJ_SYMBOL_LBL, x + pad, cy, "LAST TRADED SYMBOL",
               C'120,120,130', 8, "Segoe UI");
   cy += 16;
   CreateLabel(OBJ_SYMBOL_VAL, x + pad, cy, g_lastSymbol,
               InpAccentColor, 16, "Consolas");
   cy += 26;

   //--- Separator
   CreateRect(OBJ_SEP1, x + pad, cy, W - 2*pad, 1, C'50,50,60');
   cy += 8;

   //--- BID / ASK
   CreateLabel(OBJ_BID_VAL, x + pad, cy, "BID: ---",
               InpSellColor, 10, "Consolas");
   CreateLabel(OBJ_ASK_VAL, x + W/2 + 5, cy, "ASK: ---",
               InpBuyColor, 10, "Consolas");
   cy += 18;

   //--- Spread
   CreateLabel(OBJ_SPREAD_LBL, x + pad, cy, "Spread: --- pts",
               C'140,140,150', 9, "Consolas");
   cy += 18;

   //--- Separator
   CreateRect(OBJ_SEP2, x + pad, cy, W - 2*pad, 1, C'50,50,60');
   cy += 8;

   //--- Lot / Risk Info
   CreateLabel(OBJ_LOT_LBL, x + pad, cy, "Lot: " + DoubleToString(InpLotSize, 2),
               InpTextColor, 9, "Consolas");
   cy += 16;
   CreateLabel(OBJ_RISK_LBL, x + pad, cy,
               InpUseRiskPercent ? "Risk: " + DoubleToString(InpRiskPercent, 1) + "% of Balance"
                                 : "Risk: Fixed Lot",
               C'140,140,150', 8, "Consolas");
   cy += 16;
   CreateLabel(OBJ_SL_LBL, x + pad, cy, "SL: ---", C'211,47,47', 8, "Consolas");
   CreateLabel(OBJ_TP_LBL, x + W/2, cy, "TP: ---", C'0,150,136', 8, "Consolas");
   cy += 20;

   //--- Separator
   CreateRect(OBJ_SEP3, x + pad, cy, W - 2*pad, 1, C'50,50,60');
   cy += 8;

   //--- BUY & SELL Buttons
   int btnW = (W - 3*pad) / 2;
   int btnH = 44;
   CreateButton(OBJ_BTN_BUY, x + pad, cy, btnW, btnH,
                "▲ BUY LAST", InpBuyColor, clrWhite, 11);
   CreateButton(OBJ_BTN_SELL, x + 2*pad + btnW, cy, btnW, btnH,
                "▼ SELL LAST", InpSellColor, clrWhite, 11);
   cy += btnH + 6;

   //--- CLOSE Buttons
   CreateButton(OBJ_BTN_CLOSE, x + pad, cy, btnW, 28,
                "CLOSE LAST", C'100,70,0', clrWhite, 9);
   CreateButton(OBJ_BTN_CLOSEALL, x + 2*pad + btnW, cy, btnW, 28,
                "CLOSE ALL", C'120,30,30', clrWhite, 9);
   cy += 34;

   //--- Separator
   CreateRect(OBJ_SEP4, x + pad, cy, W - 2*pad, 1, C'50,50,60');
   cy += 8;

   //--- Account Info
   CreateLabel(OBJ_BALANCE_LBL, x + pad, cy, "Bal: ---", C'140,140,150', 8, "Consolas");
   cy += 14;
   CreateLabel(OBJ_EQUITY_LBL, x + pad, cy, "Eq: ---", C'140,140,150', 8, "Consolas");
   cy += 14;
   CreateLabel(OBJ_PNL_LBL, x + pad, cy, "P&L: ---", C'140,140,150', 8, "Consolas");
   cy += 18;

   //--- Hotkey hint
   if(InpEnableHotkeys)
   {
      CreateLabel(OBJ_HOTKEY_LBL, x + pad, cy, "Keys: B=Buy  S=Sell  X=Close",
                  C'80,80,90', 7, "Segoe UI");
      cy += 14;
   }

   //--- Status
   CreateLabel(OBJ_STATUS, x + pad, cy, "Ready", C'80,80,90', 8, "Consolas");

   //--- Resize panel bg to actual height
   int panelH = cy - y + 12;
   ObjectSetInteger(0, OBJ_PANEL_BG, OBJPROP_YSIZE, panelH);

   ChartRedraw(0);
}

//+------------------------------------------------------------------+
//| Update panel with live data                                        |
//+------------------------------------------------------------------+
void UpdatePanel()
{
   //--- Symbol
   ObjectSetString(0, OBJ_SYMBOL_VAL, OBJPROP_TEXT,
                   g_lastSymbol != "" ? g_lastSymbol : "NONE");

   if(g_lastSymbol == "" || !SymbolSelect(g_lastSymbol, true))
      return;

   int digits  = (int)SymbolInfoInteger(g_lastSymbol, SYMBOL_DIGITS);
   double bid  = SymbolInfoDouble(g_lastSymbol, SYMBOL_BID);
   double ask  = SymbolInfoDouble(g_lastSymbol, SYMBOL_ASK);
   int spread  = (int)SymbolInfoInteger(g_lastSymbol, SYMBOL_SPREAD);

   //--- BID / ASK
   ObjectSetString(0, OBJ_BID_VAL, OBJPROP_TEXT,
                   "BID: " + DoubleToString(bid, digits));
   ObjectSetString(0, OBJ_ASK_VAL, OBJPROP_TEXT,
                   "ASK: " + DoubleToString(ask, digits));

   //--- Spread
   ObjectSetString(0, OBJ_SPREAD_LBL, OBJPROP_TEXT,
                   "Spread: " + IntegerToString(spread) + " pts");

   //--- Lot size
   double lot = CalculateLotSize();
   ObjectSetString(0, OBJ_LOT_LBL, OBJPROP_TEXT,
                   "Lot: " + DoubleToString(lot, 2) +
                   (InpUseRiskPercent ? " (risk-calc)" : " (fixed)"));

   //--- SL/TP info
   if(InpAutoSLTP)
   {
      double slDist = GetSLDistance();
      double tpDist = GetTPDistance();
      double point  = SymbolInfoDouble(g_lastSymbol, SYMBOL_POINT);
      double pipSize = (digits == 3 || digits == 5) ? point * 10 : point;
      double slPips = pipSize > 0 ? slDist / pipSize : 0;
      double tpPips = pipSize > 0 ? tpDist / pipSize : 0;

      ObjectSetString(0, OBJ_SL_LBL, OBJPROP_TEXT,
                      "SL: " + DoubleToString(slPips, 1) + " pips");
      ObjectSetString(0, OBJ_TP_LBL, OBJPROP_TEXT,
                      "TP: " + DoubleToString(tpPips, 1) + " pips");
   }
   else
   {
      ObjectSetString(0, OBJ_SL_LBL, OBJPROP_TEXT, "SL: OFF");
      ObjectSetString(0, OBJ_TP_LBL, OBJPROP_TEXT, "TP: OFF");
   }

   //--- Account info
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   double eq  = AccountInfoDouble(ACCOUNT_EQUITY);
   double pnl = eq - bal;

   ObjectSetString(0, OBJ_BALANCE_LBL, OBJPROP_TEXT,
                   "Bal: $" + DoubleToString(bal, 2));
   ObjectSetString(0, OBJ_EQUITY_LBL, OBJPROP_TEXT,
                   "Eq:  $" + DoubleToString(eq, 2));
   ObjectSetString(0, OBJ_PNL_LBL, OBJPROP_TEXT,
                   "P&L: " + (pnl >= 0 ? "+" : "") + DoubleToString(pnl, 2));
   ObjectSetInteger(0, OBJ_PNL_LBL, OBJPROP_COLOR,
                    pnl >= 0 ? C'0,200,100' : C'220,50,50');

   ChartRedraw(0);
}

//+------------------------------------------------------------------+
//| File I/O — write last symbol                                       |
//+------------------------------------------------------------------+
void WriteLastSymbol(string symbol)
{
   int h = FileOpen(FILE_NAME, FILE_WRITE | FILE_TXT | FILE_COMMON);
   if(h != INVALID_HANDLE) { FileWriteString(h, symbol); FileClose(h); }
}

//+------------------------------------------------------------------+
//| File I/O — read last symbol                                        |
//+------------------------------------------------------------------+
string ReadLastSymbol()
{
   string s = "";
   int h = FileOpen(FILE_NAME, FILE_READ | FILE_TXT | FILE_COMMON);
   if(h != INVALID_HANDLE)
   {
      s = FileReadString(h);
      FileClose(h);
      StringTrimLeft(s);
      StringTrimRight(s);
   }
   return s;
}

//+------------------------------------------------------------------+
//| Normalize lot to step                                              |
//+------------------------------------------------------------------+
double NormalizeLot(double lot, double step)
{
   if(step == 0) return lot;
   return MathRound(lot / step) * step;
}

//+------------------------------------------------------------------+
//| Helper — Create rectangle                                          |
//+------------------------------------------------------------------+
void CreateRect(string name, int x, int y, int w, int h, color bg)
{
   if(ObjectFind(0, name) >= 0) ObjectDelete(0, name);
   ObjectCreate(0, name, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, name, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, name, OBJPROP_YSIZE, h);
   ObjectSetInteger(0, name, OBJPROP_BGCOLOR, bg);
   ObjectSetInteger(0, name, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, name, OBJPROP_BORDER_COLOR, C'40,40,50');
   ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, name, OBJPROP_BACK, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
}

//+------------------------------------------------------------------+
//| Helper — Create label                                              |
//+------------------------------------------------------------------+
void CreateLabel(string name, int x, int y, string text,
                 color clr, int sz, string font)
{
   if(ObjectFind(0, name) >= 0) ObjectDelete(0, name);
   ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, sz);
   ObjectSetString(0, name, OBJPROP_FONT, font);
   ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, name, OBJPROP_BACK, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
}

//+------------------------------------------------------------------+
//| Helper — Create button                                             |
//+------------------------------------------------------------------+
void CreateButton(string name, int x, int y, int w, int h,
                  string text, color bg, color txt, int sz)
{
   if(ObjectFind(0, name) >= 0) ObjectDelete(0, name);
   ObjectCreate(0, name, OBJ_BUTTON, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, name, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, name, OBJPROP_YSIZE, h);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetInteger(0, name, OBJPROP_BGCOLOR, bg);
   ObjectSetInteger(0, name, OBJPROP_COLOR, txt);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, sz);
   ObjectSetString(0, name, OBJPROP_FONT, "Segoe UI Semibold");
   ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, name, OBJPROP_BACK, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_BORDER_COLOR, C'50,50,60');
}
//+------------------------------------------------------------------+
