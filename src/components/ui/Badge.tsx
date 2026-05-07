type BadgeProps = {
  children: React.ReactNode;
  variant?: 'profit' | 'loss' | 'neutral' | 'primary' | 'warning' | 'info';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

export function Badge({
  children,
  variant = 'neutral',
  size = 'md',
  className = ''
}: BadgeProps) {
  const variantClasses = {
    profit: 'bg-[#00C853]/10 text-[#00C853] border-[#00C853]/20',
    loss: 'bg-[#FF5252]/10 text-[#FF5252] border-[#FF5252]/20',
    neutral: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    primary: 'bg-[#2196F3]/10 text-[#2196F3] border-[#2196F3]/20',
    warning: 'bg-[#FFA726]/10 text-[#FFA726] border-[#FFA726]/20',
    info: 'bg-[#26C6DA]/10 text-[#26C6DA] border-[#26C6DA]/20'
  }[variant];

  const sizeClasses = {
    sm: 'px-1.5 py-0.5 text-2xs',
    md: 'px-2 py-1 text-xs',
    lg: 'px-3 py-1.5 text-sm'
  }[size];

  return (
    <span
      className={`
        badge inline-flex items-center justify-center
        font-semibold rounded border
        ${variantClasses} ${sizeClasses} ${className}
      `}
    >
      {children}
    </span>
  );
}
