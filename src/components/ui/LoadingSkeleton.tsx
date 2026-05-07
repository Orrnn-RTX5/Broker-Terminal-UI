type LoadingSkeletonProps = {
  type?: 'text' | 'card' | 'row' | 'circle' | 'custom';
  width?: string | number;
  height?: string | number;
  count?: number;
  className?: string;
};

export function LoadingSkeleton({
  type = 'text',
  width,
  height,
  count = 1,
  className = ''
}: LoadingSkeletonProps) {
  const getSkeletonClass = () => {
    switch (type) {
      case 'text':
        return 'h-4 w-full';
      case 'card':
        return 'h-32 w-full';
      case 'row':
        return 'h-12 w-full';
      case 'circle':
        return 'h-12 w-12 rounded-full';
      case 'custom':
        return '';
      default:
        return 'h-4 w-full';
    }
  };

  const style = {
    width: width || undefined,
    height: height || undefined
  };

  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className={`skeleton ${getSkeletonClass()} ${className}`}
          style={style}
        />
      ))}
    </>
  );
}

export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="w-full space-y-2">
      {/* Header */}
      <div className="flex gap-2">
        {Array.from({ length: columns }).map((_, i) => (
          <LoadingSkeleton key={i} type="text" height={12} className="flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-2">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <LoadingSkeleton key={colIndex} type="text" height={16} className="flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ count = 1 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="panel space-y-3 p-4">
          <LoadingSkeleton type="text" width="60%" height={16} />
          <LoadingSkeleton type="text" width="100%" height={12} />
          <LoadingSkeleton type="text" width="80%" height={12} />
        </div>
      ))}
    </>
  );
}
