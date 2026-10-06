type StyleProperty = Parameters<typeof import('../../../utils/tradeOverlayStyle').setTradeOverlayStyle>[1];
type Value = { input: string; applied: string };
type Entry = { attribute: string | null; values: Map<StyleProperty, Value> };

/** Only synchronous geometry writes belong in a batch; finalize before callbacks. */
export function createTradeOverlayStyleBatchCache() {
  let cache = new WeakMap<HTMLElement, Entry>();
  let generation = 0;
  return {
    clear() { cache = new WeakMap(); generation++; },
    begin() {
      const passGeneration = generation;
      const entries = new Map<HTMLElement, { entry: Entry; dirty: boolean }>();
      let finished = false;
      return {
        set(element: HTMLElement, property: StyleProperty, input: string) {
          if (finished || passGeneration !== generation) return;
          let state = entries.get(element);
          if (!state) {
            const attribute = element.getAttribute('style');
            const previous = cache.get(element);
            state = { entry: previous?.attribute === attribute ? previous : { attribute, values: new Map() }, dirty: false };
            entries.set(element, state);
          }
          const known = state.entry.values.get(property);
          if (known?.input === input) return;
          const style = element.style;
          const current = style[property];
          if (current === input) {
            state.entry.values.set(property, { input, applied: current });
            return;
          }
          // A failed setter/finalizer must never leave a trusted stale record.
          cache.delete(element);
          state.dirty = true;
          style[property] = input;
          state.entry.values.set(property, { input, applied: style[property] });
        },
        finish() {
          if (finished) return;
          finished = true;
          try {
            if (passGeneration !== generation) return;
            for (const [element, { entry, dirty }] of entries) {
              if (dirty) {
                // Do not adopt an external/shorthand write with stale values.
                // Only changed nodes pay these verification reads.
                const attribute = element.getAttribute('style');
                for (const [property, value] of entry.values) {
                  if (element.style[property] !== value.applied) entry.values.delete(property);
                }
                entry.attribute = attribute;
              }
              cache.set(element, entry);
            }
          } catch (error) {
            for (const element of entries.keys()) cache.delete(element);
            throw error;
          } finally {
            entries.clear();
          }
        },
      };
    },
  };
}

/** Exact inputs and null outputs are retained only for this caller-owned pass. */
export function memoizeTradeOverlayCoordinate<T>(project: (value: number) => T): (value: number) => T {
  const coordinates = new Map<number, T>();
  return value => {
    if (coordinates.has(value)) return coordinates.get(value)!;
    const coordinate = project(value);
    coordinates.set(value, coordinate);
    return coordinate;
  };
}
