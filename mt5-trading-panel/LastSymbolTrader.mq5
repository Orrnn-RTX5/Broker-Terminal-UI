//+------------------------------------------------------------------+
//|                                            LastSymbolTrader.mq5  |
//|                              Last Symbol One-Click Trading Panel |
//|                                         Basic Version v1.0       |
//+------------------------------------------------------------------+
#property copyright   "LastSymbolTrader"
#property version     "1.00"
#property description "One-click BUY/SELL for the last traded symbol."
#property description "Tracks trades across all charts via shared file."
#property description "Attach to any chart — buttons always trade the last used symbol."

#include <Trade\Trade.mqh>

//--- Input Parameters
input group "=== Trade Settings ==="
input double   InpLotSize       = 0.01;    // Lot Size
input int      InpSlippage      = 10;      // Max Slippage (points)
input ulong    InpMagicNumber   = 202603;  // Magic Number
input int      InpDeviation     = 10;      // Deviation (points)

input group "=== Panel Settings ==="
input color    InpBuyColor      = clrDodgerBlue;  // Buy Button Color
input color    InpSellColor     = clrCrimson;     // Sell Button Color
input color    InpPanelBg       = C'30,30,30';    // Panel Background
input color    InpTextColor     = clrWhite;       // Text Color
input int      InpCorner        = 0;              // Panel Corner (0=TopLeft,1=TopRight,2=BotLeft,3=BotRight)
input int      InpXOffset       = 20;             // X Offset from corner
input int      InpYOffset       = 80;             // Y Offset from corner

//--- Constants
#define FILE_NAME       "last_symbol.txt"
#define BTN_BUY         "LST_BtnBuy"
#define BTN_SELL        "LST_BtnSell"
#define BTN_CLOSE       "LST_BtnClose"
#define LBL_SYMBOL      "LST_LblSymbol"
#define LBL_TITLE       "LST_LblTitle"
#define LBL_LOT         "LST_LblLot"
#define LBL_SPREAD      "LST_LblSpread"
#define PANEL_BG        "LST_PanelBg"
#define PANEL_HEADER    "LST_PanelHeader"

//--- Global Variables
CTrade         trade;
string         g_lastSymbol     = "";
datetime       g_lastCheck      = 0;

//+------------------------------------------------------------------+
//| Expert initialization function                                     |
//+------------------------------------------------------------------+
int OnInit()
{
   //--- Setup trade object
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(InpDeviation);
   trade.SetTypeFilling(ORDER_FILLING_IOC);

   //--- Read last symbol from file (if exists)
   g_lastSymbol = ReadLastSymbol();
   if(g_lastSymbol == "")
      g_lastSymbol = _Symbol; // Default to current chart symbol

   //--- Create panel
   CreatePanel();

   //--- Set timer for periodic updates (every 500ms)
   EventSetMillisecondTimer(500);

   Print("LastSymbolTrader initialized. Last symbol: ", g_lastSymbol);
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                    |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   //--- Remove all panel objects
   ObjectsDeleteAll(0, "LST_");
   EventKillTimer();
   Comment("");
}

//+------------------------------------------------------------------+
//| Expert tick function                                                |
//+------------------------------------------------------------------+
void OnTick()
{
   UpdatePanelInfo();
}

//+------------------------------------------------------------------+
//| Timer function — periodic refresh of last symbol                   |
//+------------------------------------------------------------------+
void OnTimer()
{
   //--- Re-read last symbol from shared file
   string sym = ReadLastSymbol();
   if(sym != "" && sym != g_lastSymbol)
   {
      g_lastSymbol = sym;
      UpdatePanelInfo();
   }

   //--- Update spread display
   UpdatePanelInfo();
}

//+------------------------------------------------------------------+
//| Trade transaction handler — detect new trades                      |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
{
   //--- Detect deal additions (completed trades)
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD)
   {
      //--- Get deal info
      ulong dealTicket = trans.deal;
      if(dealTicket > 0)
      {
         string dealSymbol = trans.symbol;
         ENUM_DEAL_TYPE dealType = (ENUM_DEAL_TYPE)trans.deal_type;

         //--- Only track BUY and SELL deals (not balance, commission, etc.)
         if(dealType == DEAL_TYPE_BUY || dealType == DEAL_TYPE_SELL)
         {
            if(dealSymbol != "")
            {
               g_lastSymbol = dealSymbol;
               WriteLastSymbol(dealSymbol);
               UpdatePanelInfo();
               Print("Last traded symbol updated: ", dealSymbol);
            }
         }
      }
   }

   //--- Also detect order fills via request
   if(trans.type == TRADE_TRANSACTION_ORDER_DELETE ||
      trans.type == TRADE_TRANSACTION_HISTORY_ADD)
   {
      if(request.symbol != "" && request.symbol != NULL)
      {
         if(request.action == TRADE_ACTION_DEAL)
         {
            g_lastSymbol = request.symbol;
            WriteLastSymbol(request.symbol);
            UpdatePanelInfo();
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Chart event handler — button clicks                                |
//+------------------------------------------------------------------+
void OnChartEvent(const int id, const long &lparam,
                  const double &dparam, const string &sparam)
{
   if(id == CHARTEVENT_OBJECT_CLICK)
   {
      //--- BUY LAST button
      if(sparam == BTN_BUY)
      {
         ObjectSetInteger(0, BTN_BUY, OBJPROP_STATE, false);
         ExecuteBuy();
      }
      //--- SELL LAST button
      else if(sparam == BTN_SELL)
      {
         ObjectSetInteger(0, BTN_SELL, OBJPROP_STATE, false);
         ExecuteSell();
      }
      //--- CLOSE button
      else if(sparam == BTN_CLOSE)
      {
         ObjectSetInteger(0, BTN_CLOSE, OBJPROP_STATE, false);
         ClosePositions();
      }

      ChartRedraw(0);
   }
}

//+------------------------------------------------------------------+
//| Execute BUY on last traded symbol                                  |
//+------------------------------------------------------------------+
void ExecuteBuy()
{
   if(g_lastSymbol == "")
   {
      Alert("No last traded symbol found!");
      return;
   }

   //--- Ensure symbol is selected in Market Watch
   if(!SymbolSelect(g_lastSymbol, true))
   {
      Alert("Cannot select symbol: ", g_lastSymbol);
      return;
   }

   //--- Get current ASK price
   double ask = SymbolInfoDouble(g_lastSymbol, SYMBOL_ASK);
   if(ask == 0)
   {
      Alert("Cannot get ASK price for: ", g_lastSymbol);
      return;
   }

   //--- Validate lot size
   double lotStep = SymbolInfoDouble(g_lastSymbol, SYMBOL_VOLUME_STEP);
   double minLot  = SymbolInfoDouble(g_lastSymbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(g_lastSymbol, SYMBOL_VOLUME_MAX);
   double lot     = MathMax(minLot, MathMin(maxLot, NormalizeLot(InpLotSize, lotStep)));

   //--- Execute
   if(trade.Buy(lot, g_lastSymbol, ask, 0, 0, "LST_Buy"))
   {
      Print("✓ BUY ", lot, " ", g_lastSymbol, " @ ", ask);
   }
   else
   {
      Alert("BUY failed! Error: ", GetLastError(), " | ", trade.ResultComment());
   }
}

//+------------------------------------------------------------------+
//| Execute SELL on last traded symbol                                 |
//+------------------------------------------------------------------+
void ExecuteSell()
{
   if(g_lastSymbol == "")
   {
      Alert("No last traded symbol found!");
      return;
   }

   //--- Ensure symbol is selected in Market Watch
   if(!SymbolSelect(g_lastSymbol, true))
   {
      Alert("Cannot select symbol: ", g_lastSymbol);
      return;
   }

   //--- Get current BID price
   double bid = SymbolInfoDouble(g_lastSymbol, SYMBOL_BID);
   if(bid == 0)
   {
      Alert("Cannot get BID price for: ", g_lastSymbol);
      return;
   }

   //--- Validate lot size
   double lotStep = SymbolInfoDouble(g_lastSymbol, SYMBOL_VOLUME_STEP);
   double minLot  = SymbolInfoDouble(g_lastSymbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(g_lastSymbol, SYMBOL_VOLUME_MAX);
   double lot     = MathMax(minLot, MathMin(maxLot, NormalizeLot(InpLotSize, lotStep)));

   //--- Execute
   if(trade.Sell(lot, g_lastSymbol, bid, 0, 0, "LST_Sell"))
   {
      Print("✓ SELL ", lot, " ", g_lastSymbol, " @ ", bid);
   }
   else
   {
      Alert("SELL failed! Error: ", GetLastError(), " | ", trade.ResultComment());
   }
}

//+------------------------------------------------------------------+
//| Close all positions on last traded symbol                          |
//+------------------------------------------------------------------+
void ClosePositions()
{
   if(g_lastSymbol == "")
   {
      Alert("No last traded symbol found!");
      return;
   }

   int total = PositionsTotal();
   int closed = 0;

   for(int i = total - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket > 0)
      {
         if(PositionGetString(POSITION_SYMBOL) == g_lastSymbol)
         {
            if(trade.PositionClose(ticket))
               closed++;
         }
      }
   }

   if(closed > 0)
      Print("✓ Closed ", closed, " position(s) on ", g_lastSymbol);
   else
      Print("No open positions found on ", g_lastSymbol);
}

//+------------------------------------------------------------------+
//| Create the on-chart panel                                          |
//+------------------------------------------------------------------+
void CreatePanel()
{
   int x = InpXOffset;
   int y = InpYOffset;
   int panelWidth  = 200;
   int panelHeight = 230;
   int btnWidth    = 85;
   int btnHeight   = 40;
   int padding     = 8;

   ENUM_BASE_CORNER corner = (ENUM_BASE_CORNER)InpCorner;

   //--- Panel Background
   CreateRectLabel(PANEL_BG, x, y, panelWidth, panelHeight, InpPanelBg, corner);

   //--- Panel Header
   CreateRectLabel(PANEL_HEADER, x, y, panelWidth, 28, C'45,45,45', corner);

   //--- Title Label
   CreateLabel(LBL_TITLE, x + padding, y + 6, "⚡ LAST SYMBOL TRADER",
               InpTextColor, 9, "Consolas", corner);

   //--- Last Symbol Label
   CreateLabel(LBL_SYMBOL, x + padding, y + 38, "Last: " + g_lastSymbol,
               clrGold, 12, "Consolas", corner);

   //--- Lot Size Label
   CreateLabel(LBL_LOT, x + padding, y + 62, "Lot: " + DoubleToString(InpLotSize, 2),
               clrSilver, 9, "Consolas", corner);

   //--- Spread Label
   CreateLabel(LBL_SPREAD, x + padding, y + 80, "Spread: ---",
               clrSilver, 9, "Consolas", corner);

   //--- BUY LAST Button
   CreateButton(BTN_BUY, x + padding, y + 105, btnWidth, btnHeight,
                "BUY LAST", InpBuyColor, clrWhite, corner);

   //--- SELL LAST Button
   CreateButton(BTN_SELL, x + panelWidth - btnWidth - padding, y + 105, btnWidth, btnHeight,
                "SELL LAST", InpSellColor, clrWhite, corner);

   //--- CLOSE Button
   CreateButton(BTN_CLOSE, x + padding, y + 155, panelWidth - 2 * padding, 30,
                "CLOSE LAST POSITIONS", C'80,80,80', clrWhite, corner);

   //--- Separator line effect
   CreateRectLabel("LST_Sep1", x + padding, y + 95, panelWidth - 2 * padding, 1,
                   C'60,60,60', corner);
   CreateRectLabel("LST_Sep2", x + padding, y + 192, panelWidth - 2 * padding, 1,
                   C'60,60,60', corner);

   //--- Status label
   CreateLabel("LST_Status", x + padding, y + 200, "Ready • Demo/Live Safe",
               C'100,100,100', 8, "Consolas", corner);

   ChartRedraw(0);
}

//+------------------------------------------------------------------+
//| Update panel information                                           |
//+------------------------------------------------------------------+
void UpdatePanelInfo()
{
   //--- Update symbol label
   string symText = "Last: " + (g_lastSymbol != "" ? g_lastSymbol : "NONE");
   ObjectSetString(0, LBL_SYMBOL, OBJPROP_TEXT, symText);

   //--- Update spread
   if(g_lastSymbol != "" && SymbolSelect(g_lastSymbol, true))
   {
      int spread = (int)SymbolInfoInteger(g_lastSymbol, SYMBOL_SPREAD);
      double ask = SymbolInfoDouble(g_lastSymbol, SYMBOL_ASK);
      double bid = SymbolInfoDouble(g_lastSymbol, SYMBOL_BID);
      int digits = (int)SymbolInfoInteger(g_lastSymbol, SYMBOL_DIGITS);

      string spreadText = "Spread: " + IntegerToString(spread) + " pts | "
                        + DoubleToString(bid, digits) + "/" + DoubleToString(ask, digits);
      ObjectSetString(0, LBL_SPREAD, OBJPROP_TEXT, spreadText);
   }

   //--- Update lot label
   ObjectSetString(0, LBL_LOT, OBJPROP_TEXT,
                   "Lot: " + DoubleToString(InpLotSize, 2) +
                   " | Magic: " + IntegerToString(InpMagicNumber));

   ChartRedraw(0);
}

//+------------------------------------------------------------------+
//| File I/O — Write last symbol to shared file                        |
//+------------------------------------------------------------------+
void WriteLastSymbol(string symbol)
{
   int handle = FileOpen(FILE_NAME, FILE_WRITE | FILE_TXT | FILE_COMMON);
   if(handle != INVALID_HANDLE)
   {
      FileWriteString(handle, symbol);
      FileClose(handle);
   }
   else
   {
      Print("Warning: Cannot write last symbol file. Error: ", GetLastError());
   }
}

//+------------------------------------------------------------------+
//| File I/O — Read last symbol from shared file                       |
//+------------------------------------------------------------------+
string ReadLastSymbol()
{
   string symbol = "";
   int handle = FileOpen(FILE_NAME, FILE_READ | FILE_TXT | FILE_COMMON);
   if(handle != INVALID_HANDLE)
   {
      symbol = FileReadString(handle);
      FileClose(handle);

      //--- Trim whitespace
      StringTrimLeft(symbol);
      StringTrimRight(symbol);
   }
   return symbol;
}

//+------------------------------------------------------------------+
//| Helper — Normalize lot to lot step                                 |
//+------------------------------------------------------------------+
double NormalizeLot(double lot, double step)
{
   if(step == 0) return lot;
   return MathRound(lot / step) * step;
}

//+------------------------------------------------------------------+
//| Helper — Create rectangle label (panel background)                 |
//+------------------------------------------------------------------+
void CreateRectLabel(string name, int x, int y, int width, int height,
                     color bgColor, ENUM_BASE_CORNER corner)
{
   if(ObjectFind(0, name) >= 0) ObjectDelete(0, name);
   ObjectCreate(0, name, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, name, OBJPROP_XSIZE, width);
   ObjectSetInteger(0, name, OBJPROP_YSIZE, height);
   ObjectSetInteger(0, name, OBJPROP_BGCOLOR, bgColor);
   ObjectSetInteger(0, name, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, name, OBJPROP_BORDER_COLOR, C'50,50,50');
   ObjectSetInteger(0, name, OBJPROP_CORNER, corner);
   ObjectSetInteger(0, name, OBJPROP_BACK, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
}

//+------------------------------------------------------------------+
//| Helper — Create text label                                         |
//+------------------------------------------------------------------+
void CreateLabel(string name, int x, int y, string text,
                 color clr, int fontSize, string font, ENUM_BASE_CORNER corner)
{
   if(ObjectFind(0, name) >= 0) ObjectDelete(0, name);
   ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, fontSize);
   ObjectSetString(0, name, OBJPROP_FONT, font);
   ObjectSetInteger(0, name, OBJPROP_CORNER, corner);
   ObjectSetInteger(0, name, OBJPROP_BACK, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
}

//+------------------------------------------------------------------+
//| Helper — Create button                                             |
//+------------------------------------------------------------------+
void CreateButton(string name, int x, int y, int width, int height,
                  string text, color bgColor, color txtColor, ENUM_BASE_CORNER corner)
{
   if(ObjectFind(0, name) >= 0) ObjectDelete(0, name);
   ObjectCreate(0, name, OBJ_BUTTON, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, name, OBJPROP_XSIZE, width);
   ObjectSetInteger(0, name, OBJPROP_YSIZE, height);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetInteger(0, name, OBJPROP_BGCOLOR, bgColor);
   ObjectSetInteger(0, name, OBJPROP_COLOR, txtColor);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, 10);
   ObjectSetString(0, name, OBJPROP_FONT, "Consolas");
   ObjectSetInteger(0, name, OBJPROP_CORNER, corner);
   ObjectSetInteger(0, name, OBJPROP_BACK, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_BORDER_COLOR, C'60,60,60');
}
//+------------------------------------------------------------------+
