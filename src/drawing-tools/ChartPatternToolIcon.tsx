import { CHART_PATTERN_TOOLS } from './chartPatternToolCatalog';

export function ChartPatternToolIcon({ id = 'xabcd_pattern', size = 20 }: { id?: string; size?: number }) {
  const wave = id.startsWith('elliott_');
  const tool = CHART_PATTERN_TOOLS.find(tool => tool.id === id);
  let points = [[3,19],[8,4],[12,15],[17,6],[21,19]];
  let path = 'M3 19 8 4 12 15 17 6 21 19M3 19 12 15 21 19M8 4 17 6';
  if (id === 'cypher_pattern') path += 'M3 19 17 6';
  if (id === 'head_and_shoulders') { points = [[2,20],[6,10],[9,17],[12,4],[15,17],[18,10],[22,20]]; path = 'M2 20 6 10 9 17 12 4 15 17 18 10 22 20M3 17H21'; }
  if (id === 'abcd_pattern') { points = [[3,5],[8,20],[16,4],[21,19]]; path = 'M3 5 8 20 16 4 21 19M3 5 16 4M8 20 21 19'; }
  if (id === 'triangle_pattern') { points = [[3,4],[7,20],[13,8],[18,15]]; path = 'M3 4 7 20 13 8 18 15M3 4 23 12 3 23Z'; }
  if (id === 'three_drives_pattern') { points = [[2,20],[5,10],[8,17],[12,6],[15,13],[19,2],[22,10]]; path = 'M2 20 5 10 8 17 12 6 15 13 19 2 22 10M5 10 19 2'; }
  if (wave) { points = [[2,20],[8,13],[14,18],[22,10]]; path = 'M2 20 8 13 14 18 22 10'; }
  if (id === 'cyclic_lines') { points = [[8,12],[14,12]]; path = 'M3 2V22M8 2V22M14 2V22M20 2V22'; }
  if (id === 'time_cycles') { points = [[8,18],[18,18]]; path = 'M-2 18a5 7 0 0 1 10 0a5 7 0 0 1 10 0a5 7 0 0 1 10 0'; }
  if (id === 'sine_line') { points = [[6,5],[18,19]]; path = 'M0 12C4-2 8-2 12 12S20 26 24 12'; }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true" data-pattern-icon={id}>
    <path d={path} />
    {points.map(([cx,cy],i) => <circle key={i} cx={cx} cy={cy} r="1.5" fill="var(--bg-elevated, white)" />)}
    {wave && <g stroke="none" fill="currentColor" fontSize="6" textAnchor="middle"><text x="8" y="7">{tool?.labels?.[1]?.replace(/[()]/g,'')}</text><text x="21" y="5">{tool?.labels?.at(-1)?.replace(/[()]/g,'')}</text></g>}
  </svg>;
}
