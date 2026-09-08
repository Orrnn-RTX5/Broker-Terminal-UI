export interface ShapePoint { x: number; y: number }

export function defaultDoubleCurveBends(a: ShapePoint, b: ShapePoint): [ShapePoint, ShapePoint] {
  const dx = b.x - a.x, dy = b.y - a.y;
  return [
    { x: a.x + .1 * dx + .5625 * dy, y: a.y + .1 * dy - .5625 * dx },
    { x: a.x + .9 * dx - .5625 * dy, y: a.y + .9 * dy + .5625 * dx },
  ];
}

export function doubleCurveControls(a: ShapePoint, b: ShapePoint, p: ShapePoint, q: ShapePoint): [ShapePoint, ShapePoint] {
  // Interpolate the two visible on-curve handles at t=1/4 and t=3/4.
  const component = (key: 'x' | 'y') => {
    const r = 64 * p[key] - 27 * a[key] - b[key];
    const s = 64 * q[key] - a[key] - 27 * b[key];
    return [(3 * r - s) / 72, (3 * s - r) / 72];
  };
  const x = component('x'), y = component('y');
  return [{ x: x[0], y: y[0] }, { x: x[1], y: y[1] }];
}

export function doubleCurvePath(a: ShapePoint, b: ShapePoint, bends = defaultDoubleCurveBends(a, b)): string {
  const [c, d] = doubleCurveControls(a, b, bends[0], bends[1]);
  return `M${a.x},${a.y} C${c.x},${c.y} ${d.x},${d.y} ${b.x},${b.y}`;
}

export function defaultCurveBend(a: ShapePoint, b: ShapePoint): ShapePoint {
  return { x: (a.x + b.x) / 2 - (b.y - a.y) * .15, y: (a.y + b.y) / 2 + (b.x - a.x) * .15 };
}

export function curvePath(a: ShapePoint, b: ShapePoint, bend = defaultCurveBend(a, b)): string {
  // The visible handle lies on the quadratic at t=1/2, rather than at its off-curve control point.
  return `M${a.x},${a.y} Q${2 * bend.x - (a.x + b.x) / 2},${2 * bend.y - (a.y + b.y) / 2} ${b.x},${b.y}`;
}

export function arcGeometry(a: ShapePoint, b: ShapePoint, c: ShapePoint) {
  const axis = rotatedRectangle(a, b, c);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const bend = { x: mid.x + axis.nx * axis.width, y: mid.y + axis.ny * axis.width };
  return { bend, path: `M${a.x},${a.y} Q${2 * bend.x - mid.x},${2 * bend.y - mid.y} ${b.x},${b.y}` };
}

export function ellipseGeometry(a: ShapePoint, b: ShapePoint, c: ShapePoint) {
  const axis = rotatedRectangle(a, b, c);
  const rx = Math.hypot(b.x - a.x, b.y - a.y) / 2, ry = Math.abs(axis.width);
  const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return {
    path: rx < .001 || ry < .001 ? `M${a.x},${a.y} L${b.x},${b.y}` : `M${a.x},${a.y} A${rx},${ry} ${angle} 0 1 ${b.x},${b.y} A${rx},${ry} ${angle} 0 1 ${a.x},${a.y} Z`,
    handles: [1, -1].map(sign => ({ x: center.x + sign * axis.nx * axis.width, y: center.y + sign * axis.ny * axis.width })),
  };
}

export function circlePath(center: ShapePoint, edge: ShapePoint): string {
  const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
  return `M${edge.x},${edge.y} A${radius},${radius} 0 1 0 ${2 * center.x - edge.x},${2 * center.y - edge.y} A${radius},${radius} 0 1 0 ${edge.x},${edge.y} Z`;
}

export function multiPointPath(points: ShapePoint[], arrow = false, width = 2): string {
  if (!points.length) return '';
  const path = `M${points.map(p => `${p.x},${p.y}`).join(' L')}`;
  if (!arrow || points.length < 2) return path;
  const end = points.at(-1)!;
  const previous = [...points.slice(0, -1)].reverse().find(p => Math.hypot(end.x - p.x, end.y - p.y) > .001);
  return previous ? `${path} ${arrowLinePath(previous, end, width)}` : path;
}

export function rotatedRectangle(a: ShapePoint, b: ShapePoint, c: ShapePoint) {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  const nx = length > .001 ? -dy / length : 0, ny = length > .001 ? dx / length : 1;
  const width = (c.x - b.x) * nx + (c.y - b.y) * ny;
  const corners = [
    { x: a.x + nx * width, y: a.y + ny * width },
    { x: b.x + nx * width, y: b.y + ny * width },
    { x: b.x - nx * width, y: b.y - ny * width },
    { x: a.x - nx * width, y: a.y - ny * width },
  ];
  return { corners, nx, ny, width, path: `M${corners.map(p => `${p.x},${p.y}`).join(' L')} Z` };
}

export function rectanglePath(a: ShapePoint, b: ShapePoint): string {
  return `M${a.x},${a.y} L${b.x},${a.y} L${b.x},${b.y} L${a.x},${b.y} Z`;
}

export function rectangleHandles(a: ShapePoint, b: ShapePoint) {
  return [
    { x: a.x, y: a.y, xAnchor: 0, yAnchor: 0 },
    { x: (a.x + b.x) / 2, y: a.y, yAnchor: 0 },
    { x: b.x, y: a.y, xAnchor: 1, yAnchor: 0 },
    { x: b.x, y: (a.y + b.y) / 2, xAnchor: 1 },
    { x: b.x, y: b.y, xAnchor: 1, yAnchor: 1 },
    { x: (a.x + b.x) / 2, y: b.y, yAnchor: 1 },
    { x: a.x, y: b.y, xAnchor: 0, yAnchor: 1 },
    { x: a.x, y: (a.y + b.y) / 2, xAnchor: 0 },
  ];
}

export function arrowMarkUpPath({ x, y }: ShapePoint): string {
  return `M${x},${y} L${x + 10},${y + 10} H${x + 4} V${y + 20} H${x - 4} V${y + 10} H${x - 10} Z`;
}

export function arrowMarkDownPath({ x, y }: ShapePoint): string {
  return `M${x},${y} L${x + 10},${y - 10} H${x + 4} V${y - 20} H${x - 4} V${y - 10} H${x - 10} Z`;
}

export function arrowLinePath(a: ShapePoint, b: ShapePoint, width = 2): string {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  if (length < .001) return `M${a.x},${a.y} L${b.x},${b.y}`;
  const ux = dx / length, uy = dy / length;
  const head = Math.min(length, 10 + width), half = head * .55;
  return `M${a.x},${a.y} L${b.x},${b.y} M${b.x - ux * head - uy * half},${b.y - uy * head + ux * half} L${b.x},${b.y} L${b.x - ux * head + uy * half},${b.y - uy * head - ux * half}`;
}

/** A tapered body and a proportional head, constructed from the two chart anchors. */
export function arrowMarkerPath(a: ShapePoint, b: ShapePoint): string {
  const dx = b.x - a.x, dy = b.y - a.y;
  const point = (along: number, normal: number) => `${a.x + dx * along - dy * normal},${a.y + dy * along + dx * normal}`;
  return `M${point(0, 0)} L${point(.78, -.065)} L${point(.75, -.16)} L${point(1, 0)} L${point(.75, .16)} L${point(.78, .065)} Z`;
}
