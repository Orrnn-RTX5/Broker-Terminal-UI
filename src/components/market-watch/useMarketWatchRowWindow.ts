import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';

const WINDOW_THRESHOLD = 80;
const OVERSCAN = 6;

function offsetsFor(rows: readonly string[], heights: Map<string, number>, estimate: number): number[] {
  const offsets = [0];
  for (const symbol of rows) offsets.push(offsets[offsets.length - 1] + (heights.get(symbol) ?? estimate));
  return offsets;
}

function indexAt(offsets: number[], position: number): number {
  let low = 0, high = Math.max(0, offsets.length - 2);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle + 1] <= position) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Window DOM rows only. The caller retains the complete logical quote demand. */
export function useMarketWatchRowWindow({ rows, selectedSymbol, viewportRef, headerRef, rowRefs, measurementScope }: {
  rows: readonly string[];
  selectedSymbol: string;
  viewportRef: RefObject<HTMLDivElement | null>;
  headerRef: RefObject<HTMLTableSectionElement | null>;
  rowRefs: ReadonlyMap<string, (node: HTMLTableRowElement | null) => void>;
  measurementScope: string;
}) {
  const enabled = rows.length > WINDOW_THRESHOLD;
  const rowsKey = rows.join('\u0000');
  const orderedRows = useMemo(() => rowsKey ? rowsKey.split('\u0000') : [], [rowsKey]);
  const nodes = useRef(new Map<string, HTMLTableRowElement>());
  const heights = useRef(new Map<string, number>());
  const estimate = useRef(20);
  const observer = useRef<ResizeObserver | null>(null);
  const [revision, setRevision] = useState(0);
  const [viewport, setViewport] = useState({ top: 0, height: 400, header: 24 });
  const [focusedSymbol, setFocusedSymbol] = useState<string | null>(null);
  const [draggedSymbol, setDraggedSymbol] = useState<string | null>(null);
  const [menuSymbol, setMenuSymbol] = useState<string | null>(null);
  const pending = useRef<{ symbol: string; focus: boolean } | null>(null);
  const offsets = useMemo(() => offsetsFor(orderedRows, heights.current, estimate.current), [orderedRows, revision]);
  const current = useRef({ orderedRows, offsets, enabled });
  current.current = { orderedRows, offsets, enabled };

  const readViewport = useCallback(() => {
    const element = viewportRef.current;
    if (!element) return;
    const height = element.clientHeight || 400;
    const header = headerRef.current?.getBoundingClientRect().height || 24;
    const total = current.current.offsets.at(-1) ?? 0;
    const top = Math.max(0, Math.min(element.scrollTop, Math.max(0, total - height + header)));
    setViewport(previous => previous.top === top && previous.height === height && previous.header === header
      ? previous : { top, height, header });
  }, [headerRef, viewportRef]);

  const measure = useCallback(() => {
    const element = viewportRef.current;
    if (!element) return;
    const { orderedRows: list, offsets: before } = current.current;
    const anchor = indexAt(before, element.scrollTop);
    let changed = false;
    const measured: number[] = [];
    nodes.current.forEach((node, symbol) => {
      const height = node.getBoundingClientRect().height;
      if (height > 0) {
        measured.push(height);
        if (heights.current.get(symbol) !== height) { heights.current.set(symbol, height); changed = true; }
      }
    });
    // Rows have a common compact baseline; individual wrapping rows retain
    // their own measured height. Font/skin changes also update unseen estimates.
    if (measured.length) {
      const nextEstimate = Math.min(...measured);
      if (nextEstimate !== estimate.current) { estimate.current = nextEstimate; changed = true; }
    }
    if (changed) {
      const after = offsetsFor(list, heights.current, estimate.current);
      const adjustment = (after[anchor] ?? 0) - (before[anchor] ?? 0);
      if (current.current.enabled && adjustment) element.scrollTop += adjustment;
      current.current.offsets = after;
      setRevision(value => value + 1);
    }
    readViewport();
  }, [readViewport, viewportRef]);

  useLayoutEffect(() => {
    const valid = new Set(orderedRows);
    for (const symbol of heights.current.keys()) if (!valid.has(symbol)) heights.current.delete(symbol);
  }, [orderedRows]);

  useLayoutEffect(() => {
    heights.current.clear();
    measure();
    setRevision(value => value + 1);
  }, [measurementScope, measure]);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const resize = new ResizeObserver(measure);
    observer.current = resize;
    resize.observe(element);
    if (headerRef.current) resize.observe(headerRef.current);
    nodes.current.forEach(node => resize.observe(node));
    measure();
    return () => { resize.disconnect(); observer.current = null; };
  }, [headerRef, measure, viewportRef]);

  const callbacks = useMemo(() => new Map(orderedRows.map(symbol => [symbol, (node: HTMLTableRowElement | null) => {
    const previous = nodes.current.get(symbol);
    if (previous && previous !== node) observer.current?.unobserve(previous);
    if (node) { nodes.current.set(symbol, node); observer.current?.observe(node); }
    else nodes.current.delete(symbol);
    rowRefs.get(symbol)?.(node);
  }])), [orderedRows, rowRefs]);

  const visibleIndices = useMemo(() => {
    if (!enabled) return orderedRows.map((_, index) => index);
    const start = Math.max(0, indexAt(offsets, viewport.top) - OVERSCAN);
    const end = Math.min(orderedRows.length, indexAt(offsets, viewport.top + viewport.height - viewport.header) + OVERSCAN + 1);
    const indices = new Set(Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index));
    for (const symbol of [selectedSymbol, focusedSymbol, draggedSymbol, menuSymbol]) {
      const index = symbol ? orderedRows.indexOf(symbol) : -1;
      if (index >= 0) indices.add(index);
    }
    return [...indices].sort((a, b) => a - b);
  }, [draggedSymbol, enabled, focusedSymbol, menuSymbol, offsets, orderedRows, selectedSymbol, viewport]);
  const visibleKey = visibleIndices.join(',');

  const applyPending = useCallback(() => {
    const request = pending.current;
    const element = viewportRef.current;
    if (!request || !element) return;
    const { orderedRows: list, offsets: positions, enabled: isWindowed } = current.current;
    const index = list.indexOf(request.symbol);
    if (index < 0) return; // Search may request a row just before adding it.
    const node = nodes.current.get(request.symbol);
    if (!isWindowed && node) {
      node.scrollIntoView?.({ block: 'center' });
      if (request.focus) node.focus({ preventScroll: true });
      pending.current = null;
      return;
    }
    const height = element.clientHeight || 400;
    const header = headerRef.current?.getBoundingClientRect().height || 24;
    const top = positions[index];
    const bottom = positions[index + 1];
    if (top < element.scrollTop) element.scrollTop = top;
    else if (bottom > element.scrollTop + height - header) element.scrollTop = Math.max(0, bottom - height + header);
    readViewport();
    if (node) {
      if (request.focus) node.focus({ preventScroll: true });
      pending.current = null;
    }
  }, [headerRef, readViewport, viewportRef]);

  const scrollToSymbol = useCallback((symbol: string, focus = false) => {
    pending.current = { symbol, focus };
    applyPending();
  }, [applyPending]);

  useLayoutEffect(() => { measure(); applyPending(); }, [applyPending, measure, orderedRows, visibleKey]);

  return { enabled, visibleIndices, offsets, callbacks, readViewport, scrollToSymbol,
    setFocusedSymbol, setDraggedSymbol, setMenuSymbol };
}
