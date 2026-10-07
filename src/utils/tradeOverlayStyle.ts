type OverlayStyleProperty = 'display' | 'top' | 'right' | 'bottom' | 'left' | 'width'
  | 'maxWidth' | 'transform' | 'transformOrigin' | 'borderTopColor' | 'background' | 'color';

// CSSOM can normalize a value (hex colors to rgb, for example). Remember that
// normalization, but always read the current inline value so a drag or another
// renderer changing the same property is repaired by the next geometry pass.
const normalizedValues = new WeakMap<CSSStyleDeclaration, Map<OverlayStyleProperty, { input: string; applied: string }>>();

export function setTradeOverlayStyle(element: HTMLElement, property: OverlayStyleProperty, value: string): void {
  const style = element.style;
  const current = style[property];
  if (current === value) return;
  const previous = normalizedValues.get(style)?.get(property);
  if (previous?.input === value && previous.applied === current) return;
  style[property] = value;
  const applied = style[property];
  if (applied !== value) {
    let entries = normalizedValues.get(style);
    if (!entries) { entries = new Map(); normalizedValues.set(style, entries); }
    entries.set(property, { input: value, applied });
  } else {
    normalizedValues.get(style)?.delete(property);
  }
}
