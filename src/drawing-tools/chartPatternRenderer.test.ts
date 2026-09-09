// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CHART_PATTERN_TOOLS } from './chartPatternToolCatalog';
import { patternRatio, renderChartPattern } from './chartPatternRenderer';
import type { Drawing } from '../services/drawingManager';

const render = (subtype: string, coordinates: number[][], prices = coordinates.map(p => 1000-p[1]), props: Partial<Drawing> = {}) => {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  renderChartPattern(group, {
    id: 'test', type: 'pattern', subtype,
    points: coordinates.map((p,i)=>({time:p[0],price:prices[i]})), ...props,
  }, coordinates.map(([x,y])=>({x,y})), 800, 500);
  return group;
};
const role = (g: SVGGElement, name: string) => g.querySelector(`[data-geometry-role="${name}"]`);
describe('Recorded TradingView pattern geometry', () => {
  it('uses the distinct Cypher ratios from the recorded 280/190/350/290 price legs', () => {
    const xy = [[80,380],[180,100],[280,290],[380,30],[480,320]];
    const xabcd = render('xabcd_pattern',xy), cypher = render('cypher_pattern',xy);
    expect(role(xabcd,'ratio-0-2')?.textContent).toBe('0.679');
    expect(role(xabcd,'ratio-1-3')?.textContent).toBe('1.368');
    expect(role(cypher,'ratio-1-3')?.textContent).toBe('1.25');
    expect(role(cypher,'ratio-2-4')?.textContent).toBe('1.115');
    expect(role(cypher,'ratio-0-4')?.textContent).toBe('0.829');
    expect(role(xabcd,'first-triangle')?.getAttribute('stroke')).toBe('none');
  });
  it('keeps ratios unchanged when screen scale changes', () => {
    const prices=[100,180,130,190,110];
    const a=render('xabcd_pattern',[[10,20],[30,10],[50,15],[70,8],[90,19]],prices);
    const b=render('xabcd_pattern',[[20,400],[60,200],[100,300],[140,160],[180,380]],prices);
    expect(role(a,'ratio-0-4')?.textContent).toBe(role(b,'ratio-0-4')?.textContent);
    expect(patternRatio(1,0)).toBe('—');
  });
  it('ABCD has two ratios and no background', () => {
    const g=render('abcd_pattern',[[80,100],[180,360],[280,180],[380,430]]);
    expect(role(g,'ratio-0-2')?.textContent).toBe('0.692');
    expect(role(g,'ratio-1-3')?.textContent).toBe('1.389');
    expect(g.querySelector('[data-geometry-role*="triangle"]')).toBeNull();
  });
  it('projects Triangle Pattern boundaries to their convergence', () => {
    const g=render('triangle_pattern',[[100,100],[200,400],[300,200],[400,300]]);
    expect(role(g,'triangle-boundaries')?.getAttribute('d')).toBe('M 100 100 L 450 275 L 450 275 L 100 450 Z');
  });
  it('Three Drives uses seven points and two extension ratios', () => {
    const g=render('three_drives_pattern',[[10,400],[100,160],[200,320],[300,80],[400,250],[500,0],[600,200]]);
    expect(role(g,'ratio-1-3')?.textContent).toBe('1.5');
    expect(role(g,'ratio-3-5')?.textContent).toBe('1.47');
    expect(patternRatio(1.2349, 1, 2)).toBe('1.23');
  });
  it.each(CHART_PATTERN_TOOLS.filter(t=>t.group==='Elliott waves'))('$label includes the initial zero anchor', tool => {
    const g=render(tool.id,Array.from({length:tool.requiredPoints},(_,i)=>[20+i*80,i%2 ? 50 : 300]));
    expect([...g.querySelectorAll('text')].map(el=>el.textContent)).toEqual(tool.labels);
    expect(g.querySelectorAll('rect')).toHaveLength(0);
    expect(role(g,'wave-legs')).not.toBeNull();
  });
  it('Cyclic lines repeat forward using time spacing, independent of price', () => {
    const g=render('cyclic_lines',[[100,120],[300,450]]);
    expect([...g.querySelectorAll('path')].map(el=>el.getAttribute('d'))).toEqual(['M 100 0 V 500','M 300 0 V 500','M 500 0 V 500','M 700 0 V 500']);
  });
  it.each([
    { start: 700, end: 500, visible: [700, 500, 300, 100] },
    { start: 1000, end: 800, visible: [800, 600, 400, 200, 0] },
    { start: -400, end: -200, visible: [0, 200, 400, 600, 800] },
    { start: -200, end: -400, visible: [] },
    { start: 1000, end: 1200, visible: [] },
  ])('Cyclic lines follow the anchor direction from $start to $end, including off-screen anchors', ({ start, end, visible }) => {
    const g = render('cyclic_lines', [[start, 120], [end, 450]]);
    expect([...g.querySelectorAll('path')].map(el => el.getAttribute('d'))).toEqual(visible.map(x => `M ${x} 0 V 500`));
  });
  it('bounds dense leftward Cyclic lines', () => {
    const g = render('cyclic_lines', [[800, 100], [799.5, 200]]);
    expect(g.querySelectorAll('path')).toHaveLength(1601);
    expect(g.innerHTML).not.toMatch(/NaN|Infinity/);
  });
  it('Time cycles share the first baseline and repeat to the left too', () => {
    const g=render('time_cycles',[[200,300],[400,100]]);
    expect(role(g,'time-cycle--1')?.getAttribute('d')).toBe('M 0 300 A 100 100 0 0 1 200 300');
    expect(role(g,'time-cycle-0')?.getAttribute('d')).toBe('M 200 300 A 100 100 0 0 1 400 300');
  });
  it('Sine Line anchors are opposite extrema separated by half a period', () => {
    const g=render('sine_line',[[200,300],[400,100]]);
    const d=role(g,'sine-wave')!.getAttribute('d')!;
    const coords=[...d.matchAll(/[ML] ([\d.]+) (-?[\d.e+-]+)/g)].map(m=>[Number(m[1]),Number(m[2])]);
    for(const [x,y] of coords) expect(y).toBeCloseTo(200+100*Math.cos(Math.PI*(x-200)/200),8);
  });
  it.each(['cyclic_lines','time_cycles','sine_line'])('%s handles zero and tiny periods without runaway geometry', id => {
    expect(render(id,[[10,100],[10,200]]).querySelectorAll('path')).toHaveLength(0);
    const g=render(id,[[10,100],[10.5,200]]);
    expect(g.innerHTML).not.toMatch(/NaN|Infinity/);
    expect(g.querySelectorAll('path').length).toBeLessThanOrEqual(2001);
  });
});
