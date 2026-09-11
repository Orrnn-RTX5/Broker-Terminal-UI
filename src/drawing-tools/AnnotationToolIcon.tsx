import { Type, MapPin, Table2, MessageSquare, MessageCircle, Flag, Image, Lightbulb } from 'lucide-react';

export function AnnotationToolIcon({ id, size = 20 }: { id: string; size?: number }) {
  if (id === 'post') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true"><path d="M4 3h5l11 18h-5zM20 3 4 21" /></svg>;
  if (id === 'note' || id === 'price_note') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M3 2h18v14H3zM12 16v4" /><circle cx="12" cy="22" r="1.5" />
    {id === 'note' ? <path d="M8 6h8M12 6v7" /> : <><path d="M15 6c-5-3-8 3-3 3s4 6-3 3M12 3v12" /></>}
  </svg>;
  if (id === 'price_label') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="M5 3h17v13H9l-4 4z" /><circle cx="3" cy="22" r="1.5" /></svg>;
  if (id === 'signpost') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><circle cx="12" cy="10" r="9" /><path d="m8 18-1 5 5-3 5 3-1-5M12 4l1.5 3.5 4 .4-3 2.5.9 4L12 12.3l-3.4 2.1.9-4-3-2.5 4-.4z" /></svg>;
  const Icon = ({ text: Type, pin: MapPin, table: Table2,
    callout: MessageSquare, comment: MessageCircle,
    flag: Flag, image: Image, idea: Lightbulb } as Record<string, typeof Type>)[id] ?? Type;
  return <Icon size={size} strokeWidth={1.3} aria-hidden="true" />;
}
