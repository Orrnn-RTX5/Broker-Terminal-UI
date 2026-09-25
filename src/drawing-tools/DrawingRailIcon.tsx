import { useUiTranslation } from '../hooks/useUiTranslation';
import { ReferenceToolbarGlyph, type ReferenceToolbarGlyphName } from '../components/ui/ReferenceToolbarGlyph';

type DrawingRailIconName = ReferenceToolbarGlyphName | 'lock' | 'eye-off' | 'zoom-out' | 'trade-stamps';

export function DrawingRailIcon({ name }: { name: DrawingRailIconName }) {
    useUiTranslation();
  if (name === 'trade-stamps') {
    return <svg className="web-drawing-tools-rail__glyph" width="28" height="28" viewBox="0 0 28 28"
      fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 19V5m-4 4 4-4 4 4M19 9v14m-4-4 4 4 4-4" />
      <path d="M4 23h8M15 5h8" />
    </svg>;
  }
  if (name === 'zoom-out') {
    return <svg className="web-drawing-tools-rail__glyph" width="28" height="28" viewBox="0 0 28 28"
      fill="currentColor" stroke="none" aria-hidden="true">
      <path d="M17.646 18.354l4 4 .708-.708-4-4zM12.5 21a8.5 8.5 0 1 1 0-17 8.5 8.5 0 0 1 0 17zm0-1a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM9 13h7v-1H9z" />
    </svg>;
  }
  if (name === 'lock' || name === 'eye-off') {
    return <svg className="web-drawing-tools-rail__glyph" width="28" height="28" viewBox="0 0 28 28"
      fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
      {name === 'lock' ? <><rect x="6.5" y="11.5" width="15" height="11" rx="2" /><path d="M10 11V7a4 4 0 0 1 8 0v4M14 16v2" /></> : <><path d="M6 6c2-2 4-3 7-3 6 0 10 7 10 7s-1 2-3 4M16 17c-1 .5-2 .5-3 .5C7 17.5 3 10 3 10l1-2M4 2l20 20" /></>}
    </svg>;
  }
  return <ReferenceToolbarGlyph name={name} className="web-drawing-tools-rail__glyph" />;
}
