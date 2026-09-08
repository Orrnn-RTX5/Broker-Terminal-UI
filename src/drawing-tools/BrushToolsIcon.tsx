/** The shared entry point for Brushes, Arrows, and Shapes. */
export function BrushToolsIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none"
      stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M2 23c3-2 2.7-7.2 6.4-9.6 2-1.3 4.6-.5 5.6 1.5 1.2 2.4-.3 5.3-3 6.5C8.5 22.6 5.3 22.9 2 23Z" />
      <path d="M12.5 11.8c1.8-2.1 3.1-6.8 5.1-6.8 2.1 0 1.5 5.2 3.9 5.2 1.6 0 3.2-2.8 4.5-4.8" />
    </svg>
  );
}
