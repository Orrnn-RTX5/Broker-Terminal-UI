export interface AnnotationStyle {
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  border?: boolean;
  textColor?: string;
  tableData?: string[][];
  cellWidth?: number;
  cellHeight?: number;
  imageUrl?: string;
  width?: number;
  height?: number;
  opacity?: number;
  url?: string;
  wrapWidth?: number;
  align?: 'left' | 'center' | 'right';
}

export const ANNOTATION_TOOLS = [
  { id: 'text', label: 'Text', requiredPoints: 1, editOnCreate: true, group: 'Text and notes' },
  { id: 'note', label: 'Note', requiredPoints: 2, editOnCreate: true, group: 'Text and notes' },
  { id: 'price_note', label: 'Price note', requiredPoints: 2, editOnCreate: false, group: 'Text and notes' },
  { id: 'pin', label: 'Pin', requiredPoints: 1, editOnCreate: true, group: 'Text and notes' },
  { id: 'table', label: 'Table', requiredPoints: 1, editOnCreate: true, group: 'Text and notes' },
  { id: 'callout', label: 'Callout', requiredPoints: 2, editOnCreate: true, group: 'Text and notes' },
  { id: 'comment', label: 'Comment', requiredPoints: 1, editOnCreate: true, group: 'Text and notes' },
  { id: 'price_label', label: 'Price label', requiredPoints: 1, editOnCreate: false, group: 'Text and notes' },
  { id: 'signpost', label: 'Signpost', requiredPoints: 1, editOnCreate: true, group: 'Text and notes' },
  { id: 'flag', label: 'Flag mark', requiredPoints: 1, editOnCreate: false, group: 'Text and notes' },
  { id: 'image', label: 'Image', requiredPoints: 1, editOnCreate: true, group: 'Content' },
  { id: 'post', label: 'Post', requiredPoints: 1, editOnCreate: true, group: 'Content' },
  { id: 'idea', label: 'Idea', requiredPoints: 1, editOnCreate: true, group: 'Content' },
] as const;

export const getAnnotationTool = (drawing: { type: string; subtype?: string } | null) => drawing?.type === 'text'
  ? ANNOTATION_TOOLS.find(tool => tool.id === (drawing.subtype || 'text')) : undefined;

export function isAnnotationLink(value: string, type: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (type === 'idea') return /^(www\.|[a-z]{2}\.)?tradingview\.com$/.test(url.hostname)
      && /^\/chart\/[^/]+\/[a-z\d]{8}-[^/]+\/?$/i.test(url.pathname);
    return type === 'post' && /^(www\.)?(x\.com|twitter\.com)$/.test(url.hostname)
      && /^\/\w+\/status\/\d+\/?$/.test(url.pathname);
  } catch { return false; }
}

export function isAnnotationImage(value: string): boolean {
  if (/^data:image\/(png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(value)) return value.length <= 2.8 * 1024 * 1024;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}

export function annotationLines(text: string, fontSize: number, wrapWidth?: number): string[] {
  const maxChars = wrapWidth ? Math.max(2, Math.floor(wrapWidth / (fontSize * .62))) : Infinity;
  return text.split('\n').flatMap(line => {
    if (line.length <= maxChars) return [line];
    const lines: string[] = [];
    while (line.length > maxChars) {
      const space = line.lastIndexOf(' ', maxChars);
      const split = space > 0 ? space : maxChars;
      lines.push(line.slice(0, split)); line = line.slice(split).trimStart();
    }
    lines.push(line); return lines;
  });
}

export function annotationTable(data?: string[][]): string[][] {
  if (!data?.length || !data[0]?.length) return Array.from({ length: 3 }, () => ['', '', '']);
  const columns = Math.min(10, data[0].length);
  return data.slice(0, 10).map(row => Array.from({ length: columns }, (_, c) => String(row?.[c] ?? '')));
}
