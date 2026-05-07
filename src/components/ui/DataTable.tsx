import { Icon } from './/Icon';
import { useState, useMemo } from 'react';
type Column<T> = {
  key: keyof T | string;
  header: string;
  render?: (value: any, row: T) => React.ReactNode;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  className?: string;
};

type DataTableProps<T> = {
  data: T[];
  columns: Column<T>[];
  keyExtractor: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  stickyHeader?: boolean;
  virtualized?: boolean;
  maxHeight?: string;
  className?: string;
};

export function DataTable<T extends Record<string, any>>({
  data,
  columns,
  keyExtractor,
  onRowClick,
  stickyHeader = true,
  maxHeight,
  className = ''
}: DataTableProps<T>) {
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const sortedData = useMemo(() => {
    if (!sortColumn) return data;

    return [...data].sort((a, b) => {
      const aValue = a[sortColumn];
      const bValue = b[sortColumn];

      if (aValue === bValue) return 0;

      const comparison = aValue > bValue ? 1 : -1;
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [data, sortColumn, sortDirection]);

  const handleSort = (columnKey: string) => {
    if (sortColumn === columnKey) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(columnKey);
      setSortDirection('asc');
    }
  };

  const getValue = (row: T, key: string) => {
    return key.split('.').reduce((obj, k) => obj?.[k], row as any);
  };

  return (
    <div
      className={`overflow-auto ${className}`}
      style={{ maxHeight }}
    >
      <table className="data-grid">
        <thead className={stickyHeader ? 'sticky top-0 z-10' : ''}>
          <tr>
            {columns.map((column) => (
              <th
                key={String(column.key)}
                style={{ width: column.width }}
                className={`
                  ${column.align === 'center' ? 'text-center' : column.align === 'right' ? 'text-right' : 'text-left'}
                  ${column.sortable ? 'cursor-pointer select-none hover:bg-zinc-700/50' : ''}
                  ${column.className || ''}
                `}
                onClick={() => column.sortable && handleSort(String(column.key))}
              >
                <div className="flex items-center gap-1 justify-between">
                  <span>{column.header}</span>
                  {column.sortable && (
                    <span className="text-zinc-600">
                      {sortColumn === column.key ? (
                        sortDirection === 'asc' ? (
                          <Icon name="arrow-up" size="xs" className="text-zinc-400" />
                        ) : (
                          <Icon name="arrow-down" size="xs" className="text-zinc-400" />
                        )
                      ) : (
                        <Icon name="arrow-up" size="xs" />
                      )}
                    </span>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedData.map((row) => (
            <tr
              key={keyExtractor(row)}
              onClick={() => onRowClick?.(row)}
              className={onRowClick ? 'cursor-pointer' : ''}
            >
              {columns.map((column) => {
                const value = getValue(row, String(column.key));
                return (
                  <td
                    key={String(column.key)}
                    className={`
                      ${column.align === 'center' ? 'text-center' : column.align === 'right' ? 'text-right' : 'text-left'}
                      ${column.className || ''}
                    `}
                  >
                    {column.render ? column.render(value, row) : value}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {sortedData.length === 0 && (
        <div className="p-8 text-center text-zinc-600 italic text-sm">
          No data available
        </div>
      )}
    </div>
  );
}
