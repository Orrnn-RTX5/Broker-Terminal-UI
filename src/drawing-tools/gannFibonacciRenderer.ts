import { clipLineToViewport } from './geometry/trendToolGeometry';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;
const RETRACEMENT_LEVELS = [...FIB_LEVELS, 1.618, 2.618, 3.618, 4.236] as const;
const EXTENDED_FIB_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236] as const;
const FIB_COLORS: Readonly<Record<string, string>> = {
  '0': '#787B86',
  '0.236': '#F23645',
  '0.25': '#FF9800',
  '0.382': '#FF9800',
  '0.5': '#4CAF50',
  '0.618': '#089981',
  '0.75': '#2962FF',
  '0.786': '#00BCD4',
  '1': '#787B86',
  '1.618': '#2962FF',
  '2.618': '#F23645',
  '3.618': '#787B86',
  '4.236': '#E91E63',
};

export interface GannFibonacciScreenPoint {
  x: number;
  y: number;
}

/**
 * Fib Wedge's third control is angular only: P2 establishes the radius and
 * P3 is projected onto that same circle around P1.
 */
export const projectFibWedgeBoundaryPoint = (
  origin: GannFibonacciScreenPoint,
  radiusPoint: GannFibonacciScreenPoint,
  candidate: GannFibonacciScreenPoint,
): GannFibonacciScreenPoint => {
  const radius = Math.hypot(radiusPoint.x - origin.x, radiusPoint.y - origin.y);
  if (radius <= 0.000001) return { ...origin };

  let directionX = candidate.x - origin.x;
  let directionY = candidate.y - origin.y;
  const directionLength = Math.hypot(directionX, directionY);
  if (directionLength <= 0.000001) {
    directionX = (radiusPoint.x - origin.x) / radius;
    directionY = (radiusPoint.y - origin.y) / radius;
  } else {
    directionX /= directionLength;
    directionY /= directionLength;
  }

  return {
    x: origin.x + directionX * radius,
    y: origin.y + directionY * radius,
  };
};

interface DataPoint {
  price: number;
  logicalIndex?: number;
}

export interface GannFibonacciRenderInput {
  group: SVGGElement;
  subtype: string;
  dataPoints: readonly DataPoint[];
  screenPoints: readonly (GannFibonacciScreenPoint | null)[];
  plotWidth: number;
  plotHeight: number;
  color: string;
  lineWidth: number;
  dash: string;
  opacity: string;
  priceToCoordinate: (price: number) => number | null;
  formatPrice?: (price: number) => string;
}

interface SvgHelpers {
  line: (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    role: string,
    stroke?: string,
    strokeWidth?: number,
    dashArray?: string,
  ) => SVGLineElement;
  text: (x: number, y: number, value: string, role: string, fill?: string) => SVGTextElement;
  path: (
    pathData: string,
    role: string,
    stroke?: string,
    strokeWidth?: number,
    dashArray?: string,
    fill?: string,
    fillOpacity?: number,
  ) => SVGPathElement;
  ellipse: (
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    role: string,
    stroke?: string,
  ) => SVGEllipseElement;
  rect: (
    x: number,
    y: number,
    width: number,
    height: number,
    role: string,
    fillOpacity?: number,
  ) => SVGRectElement;
  polygon: (
    points: string,
    role: string,
    fillOpacity: number,
    fill?: string,
  ) => SVGPolygonElement;
}

const levelKey = (value: number): string =>
  String(value).replace('-', 'minus-').replace('.', '-');

const colorForLevel = (level: number, fallback: string): string =>
  FIB_COLORS[String(level)] ?? fallback;

const orderedPair = (a: number, b: number): readonly [number, number] =>
  a <= b ? [a, b] : [b, a];

const ellipseRingPath = (
  cx: number,
  cy: number,
  outerRx: number,
  outerRy: number,
  innerRx: number,
  innerRy: number,
): string => {
  const outer = `M${cx - outerRx} ${cy} A${outerRx} ${outerRy} 0 1 0 ${cx + outerRx} ${cy} A${outerRx} ${outerRy} 0 1 0 ${cx - outerRx} ${cy} Z`;
  if (innerRx <= 0.000001 || innerRy <= 0.000001) return outer;
  return `${outer} M${cx - innerRx} ${cy} A${innerRx} ${innerRy} 0 1 0 ${cx + innerRx} ${cy} A${innerRx} ${innerRy} 0 1 0 ${cx - innerRx} ${cy} Z`;
};

const semiEllipseBandPath = (
  cx: number,
  cy: number,
  outerRx: number,
  outerRy: number,
  innerRx: number,
  innerRy: number,
  sweep: 0 | 1,
): string => {
  const outer = `M${cx - outerRx} ${cy} A${outerRx} ${outerRy} 0 0 ${sweep} ${cx + outerRx} ${cy}`;
  if (innerRx <= 0.000001 || innerRy <= 0.000001) return `${outer} L${cx} ${cy} Z`;
  return `${outer} L${cx + innerRx} ${cy} A${innerRx} ${innerRy} 0 0 ${sweep === 1 ? 0 : 1} ${cx - innerRx} ${cy} Z`;
};

const quarterCircleBandPath = (
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  directionX: -1 | 1,
  directionY: -1 | 1,
): string => {
  const sweep = directionX === directionY ? 1 : 0;
  const outer = `M${cx + directionX * outerRadius} ${cy} A${outerRadius} ${outerRadius} 0 0 ${sweep} ${cx} ${cy + directionY * outerRadius}`;
  if (innerRadius <= 0.000001) return `${outer} L${cx} ${cy} Z`;
  return `${outer} L${cx} ${cy + directionY * innerRadius} A${innerRadius} ${innerRadius} 0 0 ${sweep === 1 ? 0 : 1} ${cx + directionX * innerRadius} ${cy} Z`;
};

const createSvgHelpers = (input: GannFibonacciRenderInput): SvgHelpers => {
  const append = <ElementType extends SVGElement>(element: ElementType): ElementType => {
    element.style.opacity = input.opacity;
    input.group.appendChild(element);
    return element;
  };

  return {
    line: (
      x1,
      y1,
      x2,
      y2,
      role,
      stroke = input.color,
      strokeWidth = 1,
      dashArray = 'none',
    ) => {
      const element = document.createElementNS(SVG_NAMESPACE, 'line');
      element.setAttribute('x1', String(x1));
      element.setAttribute('y1', String(y1));
      element.setAttribute('x2', String(x2));
      element.setAttribute('y2', String(y2));
      element.setAttribute('stroke', stroke);
      element.setAttribute('stroke-width', String(strokeWidth));
      element.setAttribute('stroke-linecap', 'round');
      element.setAttribute('data-geometry-role', role);
      if (dashArray !== 'none') element.setAttribute('stroke-dasharray', dashArray);
      return append(element);
    },
    text: (x, y, value, role, fill = input.color) => {
      const element = document.createElementNS(SVG_NAMESPACE, 'text');
      element.setAttribute('x', String(x));
      element.setAttribute('y', String(y));
      element.setAttribute('fill', fill);
      element.setAttribute('font-size', '10');
      element.setAttribute('font-family', 'monospace, sans-serif');
      element.setAttribute('pointer-events', 'none');
      element.setAttribute('data-geometry-role', role);
      element.textContent = value;
      return append(element);
    },
    path: (
      pathData,
      role,
      stroke = input.color,
      strokeWidth = 1,
      dashArray = 'none',
      fill = 'none',
      fillOpacity,
    ) => {
      const element = document.createElementNS(SVG_NAMESPACE, 'path');
      element.setAttribute('d', pathData);
      element.setAttribute('fill', fill);
      if (fillOpacity !== undefined) element.setAttribute('fill-opacity', String(fillOpacity));
      element.setAttribute('stroke', stroke);
      element.setAttribute('stroke-width', String(strokeWidth));
      element.setAttribute('stroke-linecap', 'round');
      element.setAttribute('stroke-linejoin', 'round');
      element.setAttribute('data-geometry-role', role);
      if (dashArray !== 'none') element.setAttribute('stroke-dasharray', dashArray);
      return append(element);
    },
    ellipse: (cx, cy, rx, ry, role, stroke = input.color) => {
      const element = document.createElementNS(SVG_NAMESPACE, 'ellipse');
      element.setAttribute('cx', String(cx));
      element.setAttribute('cy', String(cy));
      element.setAttribute('rx', String(Math.max(0, rx)));
      element.setAttribute('ry', String(Math.max(0, ry)));
      element.setAttribute('fill', 'none');
      element.setAttribute('stroke', stroke);
      element.setAttribute('stroke-width', '1');
      element.setAttribute('data-geometry-role', role);
      return append(element);
    },
    rect: (x, y, width, height, role, fillOpacity = 0) => {
      const element = document.createElementNS(SVG_NAMESPACE, 'rect');
      element.setAttribute('x', String(x));
      element.setAttribute('y', String(y));
      element.setAttribute('width', String(Math.max(0, width)));
      element.setAttribute('height', String(Math.max(0, height)));
      element.setAttribute('fill', fillOpacity > 0 ? input.color : 'none');
      if (fillOpacity > 0) element.setAttribute('fill-opacity', String(fillOpacity));
      element.setAttribute('stroke', input.color);
      element.setAttribute('stroke-width', '1');
      element.setAttribute('data-geometry-role', role);
      return append(element);
    },
    polygon: (points, role, fillOpacity, fill = input.color) => {
      const element = document.createElementNS(SVG_NAMESPACE, 'polygon');
      element.setAttribute('points', points);
      element.setAttribute('fill', fill);
      element.setAttribute('fill-opacity', String(fillOpacity));
      element.setAttribute('stroke', 'none');
      element.setAttribute('data-geometry-role', role);
      return append(element);
    },
  };
};

const renderGannSquare = (
  helpers: SvgHelpers,
  first: GannFibonacciScreenPoint,
  end: GannFibonacciScreenPoint,
  prefix: 'gann-square' | 'gann-square-fixed',
): void => {
  const minX = Math.min(first.x, end.x);
  const maxX = Math.max(first.x, end.x);
  const minY = Math.min(first.y, end.y);
  const maxY = Math.max(first.y, end.y);
  const width = maxX - minX;
  const height = maxY - minY;

  helpers.rect(minX, minY, width, height, `${prefix}-frame`, 0.035);
  const gridLevels = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1] as const;
  gridLevels.slice(0, -1).forEach((level, index) => {
    const next = gridLevels[index + 1];
    const color = colorForLevel(next, '#2962FF');
    const x1 = minX + width * level;
    const x2 = minX + width * next;
    const y1 = minY + height * level;
    const y2 = minY + height * next;
    helpers.polygon(
      `${x1},${minY} ${x2},${minY} ${x2},${maxY} ${x1},${maxY}`,
      `${prefix}-grid-band-vertical-${levelKey(level)}-${levelKey(next)}`,
      0.06,
      color,
    );
    helpers.polygon(
      `${minX},${y1} ${maxX},${y1} ${maxX},${y2} ${minX},${y2}`,
      `${prefix}-grid-band-horizontal-${levelKey(level)}-${levelKey(next)}`,
      0.04,
      color,
    );
  });
  gridLevels.slice(1, -1).forEach((level) => {
    const x = minX + width * level;
    const y = minY + height * level;
    const color = colorForLevel(level, '#2962FF');
    helpers.line(x, minY, x, maxY, `${prefix}-grid-vertical-${levelKey(level)}`, color, level === 0.5 ? 1.5 : 1);
    helpers.line(minX, y, maxX, y, `${prefix}-grid-horizontal-${levelKey(level)}`, color, level === 0.5 ? 1.5 : 1);
  });

  [0.25, 0.382, 0.5, 0.618, 0.75].forEach((level) => {
    const targetX = first.x + (end.x - first.x) * level;
    helpers.line(
      first.x,
      first.y,
      targetX,
      end.y,
      `${prefix}-fan-${levelKey(level)}`,
      colorForLevel(level, '#2962FF'),
    );
  });

  const arcBase = Math.max(0.5, Math.min(width, height));
  const directionX = end.x < first.x ? -1 : 1;
  const directionY = end.y < first.y ? -1 : 1;
  [0.25, 0.382, 0.5, 0.618, 0.786, 1].forEach((level) => {
    const radius = Math.max(0.5, arcBase * level);
    helpers.path(
      `M${first.x + directionX * radius} ${first.y} A${radius} ${radius} 0 0 ${directionX === directionY ? 1 : 0} ${first.x} ${first.y + directionY * radius}`,
      `${prefix}-arc-${levelKey(level)}`,
      colorForLevel(level, '#2962FF'),
    );
  });
};

const renderGannSquareFixed = (
  helpers: SvgHelpers,
  first: GannFibonacciScreenPoint,
  second: GannFibonacciScreenPoint,
  plotWidth: number,
  plotHeight: number,
): void => {
  const radius = Math.max(0.5, Math.hypot(second.x - first.x, second.y - first.y));
  const directionX: -1 | 1 = second.x < first.x ? -1 : 1;
  const directionY: -1 | 1 = second.y < first.y ? -1 : 1;
  const reachX = directionX === 1 ? Math.max(0, plotWidth - first.x) : Math.max(0, first.x);
  const reachY = directionY === 1 ? Math.max(0, plotHeight - first.y) : Math.max(0, first.y);
  const ringCount = Math.max(1, Math.min(8, Math.ceil(Math.hypot(reachX, reachY) / radius)));
  const ringColors = ['#FF9800', '#00BCD4', '#4CAF50', '#089981', '#2962FF', '#9C27B0', '#F23645', '#787B86'] as const;

  for (let index = 1; index <= ringCount; index += 1) {
    const outerRadius = radius * index;
    const innerRadius = radius * (index - 1);
    const color = ringColors[(index - 1) % ringColors.length];
    helpers.path(
      quarterCircleBandPath(
        first.x,
        first.y,
        outerRadius,
        innerRadius,
        directionX,
        directionY,
      ),
      `gann-square-fixed-band-${index}`,
      'none',
      0,
      'none',
      color,
      0.08,
    );
  }

  const frameEnd = {
    x: first.x + directionX * radius,
    y: first.y + directionY * radius,
  };
  helpers.rect(
    Math.min(first.x, frameEnd.x),
    Math.min(first.y, frameEnd.y),
    radius,
    radius,
    'gann-square-fixed-frame',
    0.025,
  );

  for (let index = 1; index <= ringCount; index += 1) {
    const levelRadius = radius * index;
    const color = ringColors[(index - 1) % ringColors.length];
    const x = first.x + directionX * levelRadius;
    const y = first.y + directionY * levelRadius;
    helpers.line(
      x,
      first.y,
      x,
      directionY === 1 ? plotHeight : 0,
      `gann-square-fixed-grid-vertical-${index}`,
      color,
    );
    helpers.line(
      first.x,
      y,
      directionX === 1 ? plotWidth : 0,
      y,
      `gann-square-fixed-grid-horizontal-${index}`,
      color,
    );
    helpers.path(
      `M${first.x + directionX * levelRadius} ${first.y} A${levelRadius} ${levelRadius} 0 0 ${directionX === directionY ? 1 : 0} ${first.x} ${first.y + directionY * levelRadius}`,
      `gann-square-fixed-arc-${index}`,
      color,
    );
  }

  const fanTargets = [
    { x: second.x, y: second.y },
    { x: first.x + directionX * radius, y: first.y + directionY * radius * 0.5 },
    { x: first.x + directionX * radius, y: first.y + directionY * radius },
    { x: first.x + directionX * radius * 0.5, y: first.y + directionY * radius },
  ];
  fanTargets.forEach((target, index) => {
    const ray = clipLineToViewport(first, target, plotWidth, plotHeight, 'ray')
      ?? { start: first, end: target };
    helpers.line(
      ray.start.x,
      ray.start.y,
      ray.end.x,
      ray.end.y,
      `gann-square-fixed-fan-${index + 1}`,
      ringColors[index],
    );
  });
};

/**
 * Appends distinct SVG geometry for every item in the Gann/Fibonacci flyout.
 * Geometry is rebuilt from time/price anchors on every chart render, so it
 * remains attached to candles while the user pans, zooms, or resizes a pane.
 */
export const renderGannFibonacciDrawing = (input: GannFibonacciRenderInput): void => {
  const first = input.screenPoints[0];
  const second = input.screenPoints[1];
  const third = input.screenPoints[2];
  const thirdDataPoint = input.dataPoints[2];
  if (!first || !second) return;

  const helpers = createSvgHelpers(input);
  const distance = Math.hypot(second.x - first.x, second.y - first.y);

  switch (input.subtype) {
    case 'fib_retracement': {
      // The last anchor is zero and the first anchor is one in either direction.
      const endPrice = input.dataPoints[1].price;
      const priceRange = input.dataPoints[0].price - endPrice;
      const [startX, endX] = orderedPair(first.x, second.x);
      const labelX = Math.max(4, startX - 8);
      const levels = RETRACEMENT_LEVELS.map((level) => {
        const price = endPrice + priceRange * level;
        return { level, price, y: input.priceToCoordinate(price) };
      });

      levels.slice(0, -1).forEach((current, index) => {
        const next = levels[index + 1];
        if (current.y === null || next.y === null) return;
        helpers.polygon(
          `${startX},${current.y} ${endX},${current.y} ${endX},${next.y} ${startX},${next.y}`,
          `fib-retracement-band-${levelKey(current.level)}-${levelKey(next.level)}`,
          0.12,
          colorForLevel(next.level, input.color),
        );
      });

      levels.forEach(({ level, price, y }) => {
        if (y === null) return;
        const levelColor = colorForLevel(level, input.color);
        helpers.line(
          startX,
          y,
          endX,
          y,
          `fib-retracement-level-${levelKey(level)}`,
          levelColor,
          input.lineWidth,
          input.dash,
        );
        const label = helpers.text(
          labelX,
          y,
          `${level} (${input.formatPrice?.(price) ?? String(Number(price.toFixed(5)))})`,
          `fib-retracement-label-${levelKey(level)}`,
          levelColor,
        );
        label.setAttribute('text-anchor', 'end');
        label.setAttribute('dominant-baseline', 'central');
        label.setAttribute('font-size', '12');
        label.setAttribute('font-family', 'Arial, sans-serif');
      });
      helpers.line(
        first.x,
        first.y,
        second.x,
        second.y,
        'fib-retracement-reference',
        '#888888',
        1,
        '5 4',
      );
      return;
    }

    case 'trend_based_fib_extension': {
      helpers.line(
        first.x,
        first.y,
        second.x,
        second.y,
        'fib-extension-leg-ab',
        '#888888',
        1,
        '5 4',
      );
      if (!third || !thirdDataPoint) return;

      helpers.line(second.x, second.y, third.x, third.y, 'fib-extension-leg-bc', '#888888', 1, '5 4');
      const priceDelta = input.dataPoints[1].price - input.dataPoints[0].price;
      const [startX, endX] = orderedPair(second.x, third.x);
      const levels = RETRACEMENT_LEVELS.map((level) => {
        const price = thirdDataPoint.price + priceDelta * level;
        return { level, price, y: input.priceToCoordinate(price) };
      });

      levels.slice(0, -1).forEach((current, index) => {
        const next = levels[index + 1];
        if (current.y === null || next.y === null) return;
        helpers.polygon(
          `${startX},${current.y} ${endX},${current.y} ${endX},${next.y} ${startX},${next.y}`,
          `fib-extension-band-${levelKey(current.level)}-${levelKey(next.level)}`,
          0.12,
          colorForLevel(next.level, input.color),
        );
      });

      levels.forEach(({ level, price, y }) => {
        if (y === null) return;
        helpers.line(
          startX,
          y,
          endX,
          y,
          `fib-extension-level-${levelKey(level)}`,
          colorForLevel(level, input.color),
          input.lineWidth,
          input.dash,
        );
        const label = helpers.text(
          Math.max(4, startX - 8),
          y,
          `${level} (${input.formatPrice?.(price) ?? String(Number(price.toFixed(5)))})`,
          `fib-extension-label-${levelKey(level)}`,
          colorForLevel(level, input.color),
        );
        label.setAttribute('text-anchor', 'end');
        label.setAttribute('dominant-baseline', 'central');
        label.setAttribute('font-size', '12');
        label.setAttribute('font-family', 'Arial, sans-serif');
      });
      return;
    }

    case 'fib_channel': {
      if (!third) {
        helpers.line(
          first.x,
          first.y,
          second.x,
          second.y,
          'fib-channel-baseline',
          input.color,
          input.lineWidth,
          input.dash,
        );
        return;
      }

      // Level 1 begins at the third anchor. A perpendicular projection has the
      // same infinite line but the wrong ray origin and wrong displayed price.
      const offsetX = third.x - first.x;
      const offsetY = third.y - first.y;
      const channelLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618] as const;
      const segments = channelLevels.map((level) => {
        const startX = first.x + offsetX * level;
        const startY = first.y + offsetY * level;
        const endX = second.x + offsetX * level;
        const endY = second.y + offsetY * level;
        return {
          level,
          segment: clipLineToViewport(
            { x: startX, y: startY },
            { x: endX, y: endY },
            input.plotWidth,
            input.plotHeight,
            'ray',
          ) ?? { start: { x: startX, y: startY }, end: { x: endX, y: endY } },
        };
      });

      segments.slice(0, -1).forEach((current, index) => {
        const next = segments[index + 1];
        helpers.polygon(
          `${current.segment.start.x},${current.segment.start.y} ${current.segment.end.x},${current.segment.end.y} ${next.segment.end.x},${next.segment.end.y} ${next.segment.start.x},${next.segment.start.y}`,
          index === 0
            ? 'fib-channel-fill'
            : `fib-channel-band-${levelKey(current.level)}-${levelKey(next.level)}`,
          0.1,
          colorForLevel(next.level, input.color),
        );
      });

      const baseline = segments[0].segment;
      helpers.line(
        baseline.start.x,
        baseline.start.y,
        baseline.end.x,
        baseline.end.y,
        'fib-channel-baseline',
        colorForLevel(0, input.color),
        input.lineWidth,
        input.dash,
      );

      segments.forEach(({ level, segment }) => {
        if (level !== 0) helpers.line(
          segment.start.x,
          segment.start.y,
          segment.end.x,
          segment.end.y,
          `fib-channel-level-${levelKey(level)}`,
          colorForLevel(level, input.color),
          level === 1 ? input.lineWidth : 1,
          input.dash,
        );
        helpers.text(
          segment.start.x + 4,
          segment.start.y - 3,
          `${level} (${input.formatPrice?.(input.dataPoints[0].price + (input.dataPoints[2].price - input.dataPoints[0].price) * level) ?? (input.dataPoints[0].price + (input.dataPoints[2].price - input.dataPoints[0].price) * level).toFixed(2)})`,
          `fib-channel-label-${levelKey(level)}`,
          colorForLevel(level, input.color),
        );
      });
      return;
    }

    case 'fib_time_zone': {
      helpers.line(first.x, first.y, second.x, second.y, 'fib-time-zone-reference', '#888888', 1, '5 4');
      const interval = second.x - first.x;
      [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89].forEach((level) => {
        const x = first.x + interval * level;
        // Time zones use a neutral origin and the drawing color for every projection.
        const levelColor = level === 0 ? FIB_COLORS['0'] : input.color;
        helpers.line(x, 0, x, input.plotHeight, `fib-time-zone-level-${level}`, levelColor, input.lineWidth, input.dash);
        helpers.text(x + 3, Math.max(12, input.plotHeight - 6), String(level), `fib-time-zone-label-${level}`, levelColor);
      });
      return;
    }

    case 'fib_speed_resistance_fan': {
      helpers.line(first.x, first.y, second.x, second.y, 'fib-speed-fan-reference', '#888888', 1, '5 4');
      const fanLevels = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1] as const;
      const priceRays = fanLevels.map((level) => {
        const gridY = first.y + (second.y - first.y) * level;
        return {
          level,
          segment: clipLineToViewport(
            first,
            { x: second.x, y: gridY },
            input.plotWidth,
            input.plotHeight,
            'ray',
          ) ?? { start: first, end: { x: second.x, y: gridY } },
        };
      });
      const timeRays = fanLevels.map((level) => {
        const gridX = first.x + (second.x - first.x) * level;
        return {
          level,
          segment: clipLineToViewport(
            first,
            { x: gridX, y: second.y },
            input.plotWidth,
            input.plotHeight,
            'ray',
          ) ?? { start: first, end: { x: gridX, y: second.y } },
        };
      });

      [priceRays, timeRays].forEach((rays, familyIndex) => {
        rays.slice(0, -1).forEach((current, index) => {
          const next = rays[index + 1];
          helpers.polygon(
            `${first.x},${first.y} ${current.segment.end.x},${current.segment.end.y} ${next.segment.end.x},${next.segment.end.y}`,
            `fib-speed-fan-${familyIndex === 0 ? 'price' : 'time'}-band-${levelKey(current.level)}-${levelKey(next.level)}`,
            0.08,
            colorForLevel(next.level, input.color),
          );
        });
      });

      fanLevels.forEach((level, index) => {
        const gridX = first.x + (second.x - first.x) * level;
        const gridY = first.y + (second.y - first.y) * level;
        const levelColor = colorForLevel(level, input.color);
        helpers.line(
          gridX,
          Math.min(first.y, second.y),
          gridX,
          Math.max(first.y, second.y),
          `fib-speed-fan-time-grid-${levelKey(level)}`,
          levelColor,
          level === 0 || level === 1 ? 1.5 : 0.75,
        );
        helpers.line(
          Math.min(first.x, second.x),
          gridY,
          Math.max(first.x, second.x),
          gridY,
          `fib-speed-fan-price-grid-${levelKey(level)}`,
          levelColor,
          level === 0 || level === 1 ? 1.5 : 0.75,
        );
        const priceRay = priceRays[index].segment;
        helpers.line(
          priceRay.start.x,
          priceRay.start.y,
          priceRay.end.x,
          priceRay.end.y,
          `fib-speed-fan-ray-price-${levelKey(level)}`,
          levelColor,
          level === 1 ? input.lineWidth : 1,
        );
        const timeRay = timeRays[index].segment;
        helpers.line(
          timeRay.start.x,
          timeRay.start.y,
          timeRay.end.x,
          timeRay.end.y,
          `fib-speed-fan-ray-time-${levelKey(level)}`,
          levelColor,
          level === 1 ? input.lineWidth : 1,
        );
        helpers.text(
          gridX + 3,
          second.y + (second.y < first.y ? -6 : 13),
          String(Number((1 - level).toFixed(3))),
          `fib-speed-fan-time-label-${levelKey(level)}`,
          levelColor,
        );
        helpers.text(
          first.x + (second.x < first.x ? 6 : -34),
          gridY - 3,
          String(Number((1 - level).toFixed(3))),
          `fib-speed-fan-price-label-${levelKey(level)}`,
          levelColor,
        );
      });
      return;
    }

    case 'trend_based_fib_time': {
      helpers.line(
        first.x,
        first.y,
        second.x,
        second.y,
        'trend-fib-time-leg-ab',
        input.color,
        input.lineWidth,
        input.dash,
      );
      if (!third) return;
      helpers.line(second.x, second.y, third.x, third.y, 'trend-fib-time-leg-bc', '#888888', 1, '5 4');
      const interval = second.x - first.x;
      const timeLevels = [0, 0.382, 0.618, 1, 1.382, 1.618, 2, 2.382, 2.618] as const;
      timeLevels.slice(0, -1).forEach((level, index) => {
        const next = timeLevels[index + 1];
        const x1 = third.x + interval * level;
        const x2 = third.x + interval * next;
        helpers.polygon(
          `${x1},0 ${x2},0 ${x2},${input.plotHeight} ${x1},${input.plotHeight}`,
          `trend-fib-time-band-${levelKey(level)}-${levelKey(next)}`,
          0.1,
          colorForLevel(next, input.color),
        );
      });
      timeLevels.forEach((level) => {
        const x = third.x + interval * level;
        const levelColor = colorForLevel(level, input.color);
        helpers.line(
          x,
          0,
          x,
          input.plotHeight,
          `trend-fib-time-level-${levelKey(level)}`,
          levelColor,
          level === 0 || level === 1 ? 2 : 1,
        );
        helpers.text(
          x + 3,
          Math.max(12, input.plotHeight - 6),
          String(level),
          `trend-fib-time-label-${levelKey(level)}`,
          levelColor,
        );
      });
      return;
    }

    case 'fib_circles': {
      helpers.line(first.x, first.y, second.x, second.y, 'fib-circles-reference', '#888888', 1, '5 4');
      const centerX = (first.x + second.x) / 2;
      const centerY = (first.y + second.y) / 2;
      const radiusX = Math.abs(second.x - first.x) / 2;
      const radiusY = Math.abs(second.y - first.y) / 2;
      EXTENDED_FIB_LEVELS.forEach((level, index) => {
        const innerLevel = index === 0 ? 0 : EXTENDED_FIB_LEVELS[index - 1];
        const band = helpers.path(
          ellipseRingPath(
            centerX,
            centerY,
            Math.max(0.5, radiusX * level),
            Math.max(0.5, radiusY * level),
            radiusX * innerLevel,
            radiusY * innerLevel,
          ),
          `fib-circle-band-${levelKey(innerLevel)}-${levelKey(level)}`,
          'none',
          0,
          'none',
          colorForLevel(level, input.color),
          0.1,
        );
        band.setAttribute('fill-rule', 'evenodd');
        helpers.ellipse(
          centerX,
          centerY,
          radiusX * level,
          radiusY * level,
          `fib-circle-level-${levelKey(level)}`,
          colorForLevel(level, input.color),
        );
        helpers.text(
          centerX + 4,
          centerY + radiusY * level - 3,
          String(level),
          `fib-circle-label-${levelKey(level)}`,
          colorForLevel(level, input.color),
        );
      });
      return;
    }

    case 'fib_spiral': {
      helpers.line(first.x, first.y, second.x, second.y, 'fib-spiral-reference', '#888888', 1, '5 4');
      const radius = Math.max(1, distance);
      const endAngle = Math.atan2(second.y - first.y, second.x - first.x);
      const turnAngle = Math.PI * 5;
      const segments: string[] = [];
      for (let index = 0; index <= 96; index += 1) {
        const theta = -turnAngle + turnAngle * index / 96;
        const spiralRadius = radius * Math.pow(1.61803398875, theta / (Math.PI / 2));
        const x = first.x + Math.cos(endAngle + theta) * spiralRadius;
        const y = first.y + Math.sin(endAngle + theta) * spiralRadius;
        segments.push(`${index === 0 ? 'M' : 'L'}${x.toFixed(3)} ${y.toFixed(3)}`);
      }
      helpers.path(segments.join(' '), 'fib-spiral', input.color, input.lineWidth, input.dash);
      return;
    }

    case 'fib_speed_resistance_arcs': {
      helpers.line(first.x, first.y, second.x, second.y, 'fib-speed-arcs-reference', '#888888', 1, '5 4');
      const baseRadius = Math.max(0.5, distance);
      const sweep: 0 | 1 = first.y <= second.y ? 0 : 1;
      EXTENDED_FIB_LEVELS.forEach((level, index) => {
        const previousLevel = index === 0 ? 0 : EXTENDED_FIB_LEVELS[index - 1];
        const radius = Math.max(0.5, baseRadius * level);
        helpers.path(
          semiEllipseBandPath(
            first.x,
            first.y,
            radius,
            radius,
            baseRadius * previousLevel,
            baseRadius * previousLevel,
            sweep,
          ),
          `fib-speed-arc-band-${levelKey(previousLevel)}-${levelKey(level)}`,
          'none',
          0,
          'none',
          colorForLevel(level, input.color),
          0.1,
        );
        helpers.path(
          `M${first.x - radius} ${first.y} A${radius} ${radius} 0 0 ${sweep} ${first.x + radius} ${first.y}`,
          `fib-speed-arc-level-${levelKey(level)}`,
          colorForLevel(level, input.color),
        );
        helpers.text(
          first.x - 36,
          first.y + (sweep === 1 ? -radius : radius) - 3,
          String(level),
          `fib-speed-arc-label-${levelKey(level)}`,
          colorForLevel(level, input.color),
        );
      });
      return;
    }

    case 'fib_wedge': {
      const radius = Math.max(0.5, distance);
      helpers.line(
        first.x,
        first.y,
        second.x,
        second.y,
        'fib-wedge-boundary-start',
        input.color,
        input.lineWidth,
        input.dash,
      );
      if (!third) return;

      // Defensively project persisted/legacy data too, so viewport changes or
      // older payloads cannot pull the angular control away from P2's circle.
      const projectedThird = projectFibWedgeBoundaryPoint(first, second, third);
      helpers.line(
        first.x,
        first.y,
        projectedThird.x,
        projectedThird.y,
        'fib-wedge-boundary-end',
        input.color,
        input.lineWidth,
        input.dash,
      );

      const startAngle = Math.atan2(second.y - first.y, second.x - first.x);
      const endAngle = Math.atan2(
        projectedThird.y - first.y,
        projectedThird.x - first.x,
      );
      const signedSweep = Math.atan2(
        Math.sin(endAngle - startAngle),
        Math.cos(endAngle - startAngle),
      );
      const sweepFlag = signedSweep >= 0 ? 1 : 0;
      [0.236, 0.382, 0.5, 0.618, 0.786, 1].forEach((level) => {
        const levelRadius = Math.max(0.5, radius * level);
        const arcStartX = first.x + Math.cos(startAngle) * levelRadius;
        const arcStartY = first.y + Math.sin(startAngle) * levelRadius;
        const arcEndX = first.x + Math.cos(endAngle) * levelRadius;
        const arcEndY = first.y + Math.sin(endAngle) * levelRadius;
        helpers.path(
          `M${arcStartX} ${arcStartY} A${levelRadius} ${levelRadius} 0 0 ${sweepFlag} ${arcEndX} ${arcEndY}`,
          `fib-wedge-arc-level-${levelKey(level)}`,
        );
        const middleAngle = startAngle + signedSweep / 2;
        helpers.text(first.x + Math.cos(middleAngle) * levelRadius - 14,
          first.y + Math.sin(middleAngle) * levelRadius - 3, String(level),
          `fib-wedge-label-${levelKey(level)}`, colorForLevel(level, input.color));
      });
      return;
    }

    case 'pitchfan': {
      helpers.line(first.x, first.y, second.x, second.y, 'pitchfan-construction-ab', '#888888', 1, '5 4');
      if (!third) return;
      helpers.line(second.x, second.y, third.x, third.y, 'pitchfan-construction-bc', '#888888', 1, '5 4');
      const levels = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1] as const;
      const colors = ['#2962FF', '#089981', '#00BCD4', '#F23645', '#00BCD4', '#089981', '#2962FF'] as const;
      const rays = levels.map((level) => {
        const endpointX = second.x + (third.x - second.x) * level;
        const endpointY = second.y + (third.y - second.y) * level;
        return clipLineToViewport(
          first,
          { x: endpointX, y: endpointY },
          input.plotWidth,
          input.plotHeight,
          'ray',
        ) ?? { start: first, end: { x: endpointX, y: endpointY } };
      });

      rays.slice(0, -1).forEach((ray, index) => {
        const next = rays[index + 1];
        helpers.polygon(
          `${first.x},${first.y} ${ray.end.x},${ray.end.y} ${next.end.x},${next.end.y}`,
          `pitchfan-band-${levelKey(levels[index])}-${levelKey(levels[index + 1])}`,
          0.09,
          colors[index + 1],
        );
      });

      levels.forEach((level, index) => {
        const ray = rays[index];
        helpers.line(
          ray.start.x,
          ray.start.y,
          ray.end.x,
          ray.end.y,
          level === 0.5 ? 'pitchfan-median' : `pitchfan-ray-${levelKey(level)}`,
          colors[index],
          level === 0.5 ? input.lineWidth : 1,
        );
      });
      return;
    }

    case 'gann_box': {
      const minX = Math.min(first.x, second.x);
      const maxX = Math.max(first.x, second.x);
      const minY = Math.min(first.y, second.y);
      const maxY = Math.max(first.y, second.y);
      const width = maxX - minX;
      const height = maxY - minY;
      helpers.rect(minX, minY, width, height, 'gann-box-frame', 0.035);
      const boxLevels = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1] as const;
      boxLevels.slice(0, -1).forEach((level, index) => {
        const next = boxLevels[index + 1];
        const color = colorForLevel(next, input.color);
        const x1 = minX + width * level;
        const x2 = minX + width * next;
        const y1 = minY + height * level;
        const y2 = minY + height * next;
        helpers.polygon(
          `${x1},${minY} ${x2},${minY} ${x2},${maxY} ${x1},${maxY}`,
          `gann-box-time-band-${levelKey(level)}-${levelKey(next)}`,
          0.08,
          color,
        );
        helpers.polygon(
          `${minX},${y1} ${maxX},${y1} ${maxX},${y2} ${minX},${y2}`,
          `gann-box-price-band-${levelKey(level)}-${levelKey(next)}`,
          0.05,
          color,
        );
      });
      boxLevels.slice(1, -1).forEach((level) => {
        const x = minX + width * level;
        const y = minY + height * level;
        const color = colorForLevel(level, input.color);
        helpers.line(x, minY, x, maxY, `gann-box-time-level-${levelKey(level)}`, color, level === 0.5 ? 1.5 : 1);
        helpers.line(minX, y, maxX, y, `gann-box-price-level-${levelKey(level)}`, color, level === 0.5 ? 1.5 : 1);
        helpers.text(x - 10, minY - 8, String(level), `gann-box-time-label-${levelKey(level)}`, color);
        helpers.text(maxX + 7, y + 3, String(level), `gann-box-price-label-${levelKey(level)}`, color);
      });
      return;
    }

    case 'gann_square_fixed': {
      renderGannSquareFixed(helpers, first, second, input.plotWidth, input.plotHeight);
      return;
    }

    case 'gann_square': {
      renderGannSquare(helpers, first, second, 'gann-square');
      return;
    }

    case 'gann_fan': {
      const horizontalSpan = Math.abs(second.x - first.x) > 0.5
        ? second.x - first.x
        : (second.x < first.x ? -100 : 100);
      const verticalSpan = second.y - first.y;
      const ratios = [
        { key: '1x8', value: 0.125, color: '#F23645' },
        { key: '1x4', value: 0.25, color: '#E91E63' },
        { key: '1x3', value: 1 / 3, color: '#9C27B0' },
        { key: '1x2', value: 0.5, color: '#2962FF' },
        { key: '1x1', value: 1, color: '#00BCD4' },
        { key: '2x1', value: 2, color: '#089981' },
        { key: '3x1', value: 3, color: '#4CAF50' },
        { key: '4x1', value: 4, color: '#089981' },
        { key: '8x1', value: 8, color: '#FF9800' },
      ] as const;
      const rays = ratios.map(({ key, value, color }) => {
        const candidate = {
          x: first.x + horizontalSpan,
          y: first.y + verticalSpan * value,
        };
        const segment = clipLineToViewport(first, candidate, input.plotWidth, input.plotHeight, 'ray')
          ?? { start: first, end: candidate };
        return { key, color, segment };
      });

      rays.slice(0, -1).forEach((ray, index) => {
        const next = rays[index + 1];
        helpers.polygon(
          `${first.x},${first.y} ${ray.segment.end.x},${ray.segment.end.y} ${next.segment.end.x},${next.segment.end.y}`,
          `gann-fan-band-${ray.key}-${next.key}`,
          0.09,
          next.color,
        );
      });

      rays.forEach(({ key, color, segment }) => {
        helpers.line(
          segment.start.x,
          segment.start.y,
          segment.end.x,
          segment.end.y,
          `gann-fan-ray-${key}`,
          color,
          key === '1x1' ? input.lineWidth : 1,
        );
        helpers.text(
          segment.end.x - 25,
          segment.end.y + (segment.end.y < 16 ? 13 : -4),
          key.split('x').reverse().join('/'),
          `gann-fan-label-${key}`,
          color,
        );
      });
      return;
    }

    default: {
      // Unknown persisted Fibonacci subtypes retain the legacy retracement
      // visual instead of disappearing after an upgrade.
      const priceHigh = Math.max(input.dataPoints[0].price, input.dataPoints[1].price);
      const priceLow = Math.min(input.dataPoints[0].price, input.dataPoints[1].price);
      const priceRange = priceHigh - priceLow;
      FIB_LEVELS.forEach((level) => {
        const price = priceLow + priceRange * (1 - level);
        const y = input.priceToCoordinate(price);
        if (y === null) return;
        helpers.line(
          Math.min(first.x, second.x),
          y,
          input.plotWidth,
          y,
          `fib-retracement-level-${levelKey(level)}`,
          FIB_COLORS[level.toString()] || input.color,
        );
      });
      helpers.line(first.x, first.y, second.x, second.y, 'fib-retracement-reference', '#888888', 1, '5 4');
    }
  }
};
