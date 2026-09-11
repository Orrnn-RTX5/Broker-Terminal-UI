import { useUiTranslation } from '../hooks/useUiTranslation';
export function BrushShapeToolIcon({ id, size = 20 }: { id?: string; size?: number }) {
    const tr = useUiTranslation();
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {id === 'double_curve' ? <path d="M3 20C29 24-6 0 21 4" /> : id === 'curve' ? <><path d="M3 21Q3 3 21 3" /><circle cx="8" cy="8" r="1.5" /></> : id === 'arc' ? <path d="M3 20Q12-12 21 20" /> : id === 'triangle' ? <path d="m4 3 17 18H4Z" /> : id === 'polyline' ? <><path d="m3 18 5-12 8-2 5 9-8 6" />{[[3,18],[8,6],[16,4],[21,13],[13,19]].map(([x,y]) => <circle key={x} cx={x} cy={y} r="1.5" />)}</> : id === 'ellipse' ? <ellipse cx="12" cy="12" rx="10" ry="6" transform="rotate(-25 12 12)" /> : id === 'circle' ? <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="1" /></> : id === 'path' ? <path d="m2 19 6-10 7 5 7-11m-5 0h5v5" /> : id === 'rotated_rectangle' ? <rect x="3" y="6" width="18" height="12" transform="rotate(-35 12 12)" /> : id === 'rectangle' ? <rect x="3" y="5" width="18" height="14" /> : id === 'arrow_mark_down' ? <path d="m12 21 9-10h-6V3H9v8H3Z" /> : id === 'arrow_mark_up' ? <path d="m12 3 9 10h-6v8H9v-8H3Z" /> : id === 'arrow' ? <><path d="M4 20 20 4M12 4h8v8" /><circle cx="4" cy="20" r="1.5" /></> : <path d="M3 21 15 7 12 5 22 2 19 12 17 9Z" />}
  </svg>;
}
