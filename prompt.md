
Here is the prompt:


You are a frontend developer integrating with the RTX5 Broker Backend (Gateway service).
Base URL: http://localhost:8090
WebSocket URL: ws://localhost:8090











Store token and account_login. Send token on every request:

Authorization: Bearer eyJhbGci...




Task 1 — Load Open Positions on Page Load (REST)


GET /api/v2/positions/{account_login}
Authorization: Bearer <token>


Response is an array:

















[
  {
    "ticket":        100045,
    "account_login": 1000123,
    "symbol":        "XAUUSD",
    "side":          "buy",
    "volume":        0.10,
    "price_open":    1923.45,
    "price_current": 1925.80,
    "price_sl":      1910.00,
    "price_tp":      1950.00,
    "profit":        23.50,
    "swap":          -0.12,
    "time_create":   1716825600,
    "comment":       "manual"
  }
]


profit and price_current are already live-calculated at request time. Render these in a positions table.


Task 2 — Connect WebSocket for Live Updates
Connect after login:

ws://localhost:8090/ws/v2?token=<token>


On connection open, send these subscribe messages:



{"action": "subscribe", "channel": "positions.1000123"}
{"action": "subscribe", "channel": "metrics.1000123"}
{"action": "subscribe", "channel": "ticks.XAUUSD"}


Replace 1000123 with real account_login. Add one ticks.{SYMBOL} subscribe per symbol the user has open positions in.


Task 3 — Handle WebSocket Messages
All messages follow this shape:

{ "channel": "...", "data": { ... } }


positions.{login} — fires on every price tick















{
  "channel": "positions.1000123",
  "data": {
    "login": 1000123,
    "positions": [
      {
        "ticket":        100045,
        "symbol":        "XAUUSD",
        "profit":        25.10,
        "price_current": 1926.06,
        "swap":          -0.12
      }
    ]
  }
}


Action: find position by ticket, update only profit and price_current. Do not replace the full position object.


metrics.{login} — fires on every tick and every trade event

















{
  "channel": "metrics.1000123",
  "data": {
    "type": "metrics_update",
    "data": {
      "login":        1000123,
      "balance":      10000.00,
      "credit":       0.00,
      "equity":       9823.45,
      "used_margin":  500.00,
      "free_margin":  9323.45,
      "margin_level": 1964.69,
      "floating_pnl": -176.55,
      "total_swap":   0.00
    }
  }
}


Action: update the account summary bar. margin_level = 0 means no positions — display as ∞.


ticks.{SYMBOL} — fires on every price update









{
  "channel": "ticks.XAUUSD",
  "data": {
    "symbol": "XAUUSD",
    "bid":    1926.06,
    "ask":    1926.21,
    "time":   1716829200
  }
}


Action: update live bid/ask price display for that symbol.


Task 4 — Close a Position





POST /api/v2/positions/{ticket}/close
Authorization: Bearer <token>
Content-Type: application/json

{}


After success, the metrics WebSocket fires automatically with updated balance/equity.


Implementation Rules

Load positions via REST first on page load — never wait for WebSocket for the initial list.
On positions.* WebSocket message — patch only profit and price_current per ticket, never replace the full row.
metrics.* is the single source of truth for equity, free margin, margin level — do not calculate these yourself.
Subscribe ticks.{SYMBOL} only for symbols the user has open positions in.
On WebSocket disconnect — reconnect after 3 seconds and re-subscribe all channels.
Display margin_level = 0 as ∞ in the UI.
time_create is a Unix timestamp in seconds — convert to local time for display.
side is either "buy" or "sell" — colour buy green, sell red.

