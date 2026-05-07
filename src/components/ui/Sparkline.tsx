import { useMemo } from 'react';

type SparklineProps = {
  data: number[];
  width?: number;
  height?: number;
  color?: 'profit' | 'loss' | 'neutral';
  showFill?: boolean;
  className?: string;
};

export function Sparkline({
  data,
  width = 60,
  height = 24,
  color = 'neutral',
  showFill = true,
  className = ''
}: SparklineProps) {
  const { path, fillPath, colorClass } = useMemo(() => {
    if (data.length < 2) {
      return { path: '', fillPath: '', colorClass: 'stroke-zinc-600' };
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    // Calculate points
    const points = data.map((value, index) => ({
      x: (index / (data.length - 1)) * width,
      y: height - ((value - min) / range) * height
    }));

    // Create line path
    const linePath = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
      .join(' ');

    // Create fill path
    const areaPath = showFill
      ? `${linePath} L ${width} ${height} L 0 ${height} Z`
      : '';

    // Determine color based on trend
    const trend = data[data.length - 1] - data[0];
    let strokeColor = 'stroke-zinc-600';
    let fillColor = 'fill-zinc-800/20';

    if (color === 'profit' || (color === 'neutral' && trend > 0)) {
      strokeColor = 'stroke-[#00C853]';
      fillColor = 'fill-[#00C853]/10';
    } else if (color === 'loss' || (color === 'neutral' && trend < 0)) {
      strokeColor = 'stroke-[#FF5252]';
      fillColor = 'fill-[#FF5252]/10';
    }

    return {
      path: linePath,
      fillPath: areaPath,
      colorClass: `${strokeColor} ${fillColor}`
    };
  }, [data, width, height, color, showFill]);

  if (data.length < 2) {
    return (
      <svg width={width} height={height} className={className}>
        <line
          x1="0"
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth="1"
          className="stroke-zinc-800"
          strokeDasharray="2,2"
        />
      </svg>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      className={`sparkline ${className}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      {showFill && fillPath && (
        <path d={fillPath} className={colorClass} />
      )}
      <path
        d={path}
        fill="none"
        className={colorClass}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
