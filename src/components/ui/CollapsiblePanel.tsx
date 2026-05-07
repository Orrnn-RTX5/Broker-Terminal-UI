import { Icon } from './/Icon';
import { useState } from 'react';
type CollapsiblePanelProps = {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

export function CollapsiblePanel({
  title,
  children,
  defaultOpen = true,
  icon,
  actions,
  className = ''
}: CollapsiblePanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`panel ${className}`}>
      <div
        className="panel-header cursor-pointer select-none flex items-center justify-between hover:bg-zinc-800/50 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          <button
            className="text-zinc-400 hover:text-zinc-200 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(!isOpen);
            }}
          >
            {isOpen ? <Icon name="chevron-down" size="md" /> : <Icon name="chevron-right" size="md" />}
          </button>
          {icon && <span className="text-zinc-400">{icon}</span>}
          <h3 className="font-semibold text-zinc-200">{title}</h3>
        </div>
        {actions && (
          <div onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        )}
      </div>
      {isOpen && (
        <div className="panel-content">
          {children}
        </div>
      )}
    </div>
  );
}
