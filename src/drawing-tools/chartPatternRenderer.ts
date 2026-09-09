import type { Drawing } from '../services/drawingManager';
import { getChartPatternTool } from './chartPatternToolCatalog';

export interface PatternScreenPoint { x: number; y: number }
const NS = 'http://www.w3.org/2000/svg';
/** Ratios use anchor prices, independent of zoom or logarithmic chart scaling. */
export const patternRatio = (numerator: number, denominator: number, precision = 3): string =>
  Math.abs(denominator) < 1e-12 ? '—' : String(Number(Math.abs(numerator / denominator).toFixed(precision)));

export function renderChartPattern(group: SVGGElement, drawing: Drawing, points: Array<PatternScreenPoint | null>, width: number, height: number) {
  const tool = getChartPatternTool(drawing);
  if (!tool || !points.length || points.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return;
  const p = points as PatternScreenPoint[];
  const color = drawing.color || '#2962ff';
  const add = (tag: string, attrs: Record<string, string | number>, role: string) => {
    const element = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
    element.setAttribute('data-geometry-role', role);
    group.appendChild(element);
    return element;
  };
  const line = (indices: number[], role: string, dotted = false, fill = false) => {
    if (indices.some(index => !p[index])) return;
    return add('path', {
      d: indices.map((index, i) => `${i ? 'L' : 'M'} ${p[index].x} ${p[index].y}`).join(' ') + (fill ? ' Z' : ''),
      stroke: fill ? 'none' : color, 'stroke-width': dotted ? 1 : drawing.lineWidth || 2,
      'stroke-dasharray': dotted ? '2 3' : drawing.lineStyle === 'dashed' ? '8 5' : drawing.lineStyle === 'dotted' ? '2 4' : '',
      fill: fill && drawing.fillColor !== '' ? drawing.fillColor || color : 'none',
      'fill-opacity': drawing.fillOpacity ?? .12, 'stroke-linejoin': 'round',
      'pointer-events': fill ? 'visiblePainted' : 'stroke',
    }, role);
  };
  const label = (point: PatternScreenPoint, text: string, role: string, badge = false) => {
    if (badge) add('rect', { x: point.x - (text.length * 3.5 + 3), y: point.y - 9, width: text.length * 7 + 6, height: 18, rx: 2, fill: color, 'pointer-events': 'none' }, `${role}-background`);
    const element = add('text', { x: point.x, y: point.y, fill: badge ? '#fff' : color, 'font-size': 12, 'font-family': 'Arial, sans-serif', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'pointer-events': 'none' }, role);
    element.textContent = text;
  };
  const ratio = (a: number, b: number, numerator: [number, number], denominator: [number, number]) => {
    if (![a, b, ...numerator, ...denominator].every(i => p[i])) return;
    line([a, b], `ratio-line-${a}-${b}`, true);
    const value = patternRatio(drawing.points[numerator[1]].price - drawing.points[numerator[0]].price, drawing.points[denominator[1]].price - drawing.points[denominator[0]].price, tool.id === 'three_drives_pattern' ? 2 : 3);
    label({ x: (p[a].x + p[b].x) / 2, y: (p[a].y + p[b].y) / 2 }, value, `ratio-${a}-${b}`, true);
  };

  if (tool.id === 'xabcd_pattern' || tool.id === 'cypher_pattern') {
    line([0, 1, 2], 'first-triangle', false, true);
    line([2, 3, 4], 'second-triangle', false, true);
    line(p.map((_, i) => i), 'pattern-legs');
    ratio(0, 2, [1, 2], [0, 1]);
    ratio(1, 3, tool.id === 'cypher_pattern' ? [0, 3] : [2, 3], tool.id === 'cypher_pattern' ? [0, 1] : [1, 2]);
    ratio(2, 4, [3, 4], [2, 3]);
    ratio(0, 4, tool.id === 'cypher_pattern' ? [3, 4] : [1, 4], tool.id === 'cypher_pattern' ? [0, 3] : [0, 1]);
  }
  if (tool.id === 'sine_line' && p.length >= 2) {
    const halfPeriod = Math.abs(p[1].x-p[0].x);
    if (halfPeriod >= .5) {
      const middle = (p[0].y+p[1].y)/2, amplitude = (p[0].y-p[1].y)/2;
      const count = Math.min(12000, Math.max(2, Math.ceil(width / Math.min(3, halfPeriod / 16))));
      const path = Array.from({ length: count + 1 }, (_, i) => {
        const x = width*i/count;
        return `${i ? 'L' : 'M'} ${x} ${middle+amplitude*Math.cos(Math.PI*(x-p[0].x)/halfPeriod)}`;
      }).join(' ');
      add('path', { d: path, fill: 'none', stroke: color, 'stroke-width': drawing.lineWidth || 2, 'stroke-dasharray': drawing.lineStyle === 'dashed' ? '8 5' : drawing.lineStyle === 'dotted' ? '2 4' : '', 'pointer-events': 'stroke' }, 'sine-wave');
    }
  }
  if (tool.id === 'time_cycles' && p.length >= 2) {
    const spacing = Math.abs(p[1].x-p[0].x);
    if (spacing >= .5) {
      const radius = spacing/2;
      const first = Math.floor(-p[0].x/spacing);
      const last = Math.min(first+2000, Math.ceil((width-p[0].x)/spacing));
      for(let i=first;i<last;i++) {
        const x = p[0].x+i*spacing;
        add('path', { d: `M ${x} ${p[0].y} A ${radius} ${radius} 0 0 1 ${x+spacing} ${p[0].y}`, fill: drawing.fillColor === '' ? 'none' : drawing.fillColor || color, 'fill-opacity': drawing.fillOpacity ?? .3, stroke: color, 'stroke-width': drawing.lineWidth || 2, 'stroke-dasharray': drawing.lineStyle === 'dashed' ? '8 5' : drawing.lineStyle === 'dotted' ? '2 4' : '', 'pointer-events': 'visiblePainted' }, `time-cycle-${i}`);
      }
    }
  }
  if (tool.id === 'cyclic_lines' && p.length >= 2) {
    // The second anchor defines both spacing and direction, including when
    // dragging it across the first anchor. Keep the signed interval.
    const spacing = p[1].x-p[0].x;
    if (Math.abs(spacing) >= .5) {
      const entryEdge = spacing > 0 ? 0 : width;
      const exitEdge = spacing > 0 ? width : 0;
      const first = Math.max(0, Math.ceil((entryEdge-p[0].x)/spacing));
      const last = Math.min(first + 2000, Math.floor((exitEdge-p[0].x)/spacing));
      for (let i=first;i<=last;i++) add('path', { d: `M ${p[0].x+i*spacing} 0 V ${height}`, fill: 'none', stroke: color, 'stroke-width': drawing.lineWidth || 1, 'stroke-dasharray': drawing.lineStyle === 'dashed' ? '8 5' : drawing.lineStyle === 'dotted' ? '2 4' : '', 'pointer-events': 'stroke' }, `cycle-line-${i}`);
    }
    if (drawing.selected) line([0,1], 'cycle-anchor-guide', true);
  }
  if (tool.group === 'Elliott waves') line(p.map((_,i)=>i), 'wave-legs');
  if (tool.id === 'three_drives_pattern') {
    line(p.map((_,i)=>i), 'pattern-legs');
    ratio(1, 3, [2, 3], [1, 2]);
    ratio(3, 5, [4, 5], [3, 4]);
  }
  if (tool.id === 'abcd_pattern') {
    line(p.map((_, i) => i), 'pattern-legs');
    ratio(0, 2, [1, 2], [0, 1]);
    ratio(1, 3, [2, 3], [1, 2]);
  }
  if (tool.id === 'triangle_pattern') {
    if (p.length >= 4) {
      const [a,b,c,d] = p;
      const upperDx = c.x-a.x, lowerDx = d.x-b.x;
      if (Math.abs(upperDx) > 1e-8 && Math.abs(lowerDx) > 1e-8) {
        const upperSlope = (c.y-a.y)/upperDx, lowerSlope = (d.y-b.y)/lowerDx;
        const left = Math.min(a.x,b.x);
        const intersection = Math.abs(upperSlope-lowerSlope) > 1e-8 ? (b.y-a.y+upperSlope*a.x-lowerSlope*b.x)/(upperSlope-lowerSlope) : width;
        const right = Math.min(width * 4, Math.max(-width * 4, intersection));
        const upper = (x:number) => a.y+upperSlope*(x-a.x);
        const lower = (x:number) => b.y+lowerSlope*(x-b.x);
        add('path', { d: `M ${left} ${upper(left)} L ${right} ${upper(right)} L ${right} ${lower(right)} L ${left} ${lower(left)} Z`, fill: drawing.fillColor === '' ? 'none' : drawing.fillColor || color, 'fill-opacity': drawing.fillOpacity ?? .12, stroke: color, 'stroke-width': 1, 'stroke-dasharray': '2 4', 'pointer-events': 'visiblePainted' }, 'triangle-boundaries');
      }
    }
    line(p.map((_,i)=>i), 'pattern-legs');
  }
  if (tool.id === 'head_and_shoulders') {
    line(p.map((_, i) => i), 'pattern-legs');
    if (p.length >= 5) {
      const intersect = (a: PatternScreenPoint, b: PatternScreenPoint) => {
        const c = p[2], d = p[4];
        const dx = b.x - a.x, dy = b.y - a.y;
        const ex = d.x - c.x, ey = d.y - c.y;
        const divisor = dx * ey - dy * ex;
        if (Math.abs(divisor) < 1e-8) return a;
        const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / divisor;
        return { x: a.x + t * dx, y: a.y + t * dy };
      };
      const left = intersect(p[0], p[1]);
      const right = p[6] ? intersect(p[5], p[6]) : p[4];
      const body = [left, ...p.slice(1, p[6] ? 6 : 5), right];
      add('path', { d: body.map((v,i) => `${i ? 'L' : 'M'} ${v.x} ${v.y}`).join(' ') + ' Z', fill: drawing.fillColor === '' ? 'none' : drawing.fillColor || color, 'fill-opacity': drawing.fillOpacity ?? .12, 'pointer-events': 'visiblePainted' }, 'shoulders-fill');
      add('path', { d: `M ${left.x} ${left.y} L ${right.x} ${right.y}`, stroke: color, 'stroke-width': 1, 'stroke-dasharray': '2 4', 'pointer-events': 'stroke' }, 'neckline');
    }
  }
  p.forEach((point, i) => {
    const text = tool.labels?.[i];
    if (!text) return;
    const neighbor = p[i === 0 ? 1 : i - 1];
    const above = neighbor ? point.y < neighbor.y : i % 2 === 1;
    label({ x: point.x, y: point.y + (above ? -20 : 20) }, text, `pattern-label-${i}`, tool.group !== 'Elliott waves');
  });
}
