export const TRADING_VIEW_HANDLE_SCROLL = {
  vertTouchDrag: false,
  horzTouchDrag: true,
  mouseWheel: true,
  pressedMouseMove: true,
} as const;

export const TRADING_VIEW_HANDLE_SCALE = {
  // Price-axis dragging is custom; the native hyperbolic handler stays off.
  axisPressedMouseMove: { time: true, price: false },
  axisDoubleClickReset: { time: true, price: true },
  mouseWheel: true,
  pinch: true,
} as const;

export const DRAWING_LOCK_HANDLE_SCROLL = {
  vertTouchDrag: false,
  horzTouchDrag: false,
  mouseWheel: false,
  pressedMouseMove: false,
} as const;

export const DRAWING_LOCK_HANDLE_SCALE = {
  axisPressedMouseMove: false,
  axisDoubleClickReset: false,
  mouseWheel: false,
  pinch: false,
} as const;
