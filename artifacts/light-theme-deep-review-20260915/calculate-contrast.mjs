import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Research calculations only. No application code is imported or modified.
const directory = path.dirname(fileURLToPath(import.meta.url));
const rgb = hex => hex.replace('#', '').match(/../g).map(channel => parseInt(channel, 16));
const luminance = color => {
  const channels = (Array.isArray(color) ? color : rgb(color)).map(value => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
const ratio = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)].sort((a,b) => b-a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};
const composite = (foreground, alpha, background) => rgb(foreground).map((c,i) => c*alpha + rgb(background)[i]*(1-alpha));
const hex = channels => '#' + channels.map(c => Math.round(c).toString(16).padStart(2, '0')).join('').toUpperCase();
if (ratio('#000000', '#FFFFFF') !== 21 || ratio('#FFFFFF', '#FFFFFF') !== 1) throw new Error('Contrast formula sanity check failed');

const surfaces = {
  elevated: '#FFFFFF', panel: '#FAFAFA', canvas_chart: '#F7F8FA', chrome_hover: '#F2F4F8',
  field: '#F2F6FC', selected: '#EEF2FF', pressed: '#E8ECF2',
};
const coreText = {
  primary: '#111827', financial: '#0F172A', secondary: '#4B5563', muted: '#5F6B7A',
  accent: '#4338CA', quote_up: '#1D4ED8', profit: '#047857', loss_quote_down: '#B91C1C',
};
const pairs = [];
const add = (role, foreground, background, threshold, note='') => {
  const contrast = ratio(foreground, background);
  const item = {role, foreground: Array.isArray(foreground) ? hex(foreground) : foreground,
    background: Array.isArray(background) ? hex(background) : background,
    contrast, threshold, result: threshold == null ? 'CONTEXT' : contrast >= threshold ? 'PASS' : 'FAIL', note};
  pairs.push(item);
  return item;
};
for (const [role, foreground] of Object.entries(coreText)) {
  for (const [surface, background] of Object.entries(surfaces)) add(`core_text:${role}:${surface}`, foreground, background, 4.5);
}
const corePairs = pairs.length;
for (const [role, background] of Object.entries({buy:'#2563EB',buy_hover:'#1D4ED8',buy_pressed:'#1E40AF',sell:'#DC2626',sell_hover:'#B91C1C',sell_pressed:'#991B1B',accent:'#4338CA',accent_hover:'#3730A3',accent_pressed:'#312E81',profit_label:'#047857',loss_label:'#B91C1C'})) add(`white_label:${role}`, '#FFFFFF', background, 4.5);
for (const [surface, background] of Object.entries(surfaces)) add(`control_border:${surface}`, '#7D8796', background, 3);
const chart = surfaces.canvas_chart;
add('default_bull_candle', '#059669', chart, 3);
add('default_bear_candle', '#DC2626', chart, 3);
add('live_ohlc_high_text', '#16A34A', chart, 4.5, 'Live 13px value retains inline green; both ancestor and value backgrounds transparent');
add('live_ohlc_low_text', '#DC2626', chart, 4.5, 'Passes narrowly on plain chart background');
add('suggested_ohlc_high_text', '#047857', chart, 4.5);
add('suggested_blue_preset_bull', '#2563EB', chart, 3);
add('suggested_blue_preset_bear', '#DC2626', chart, 3);
add('suggested_yellow_preset_amber', '#A16207', chart, 3, 'Candidate for light line and wick, not a validated whole-preset design');
add('crosshair', '#64748B', chart, 3);
add('grid', composite('#2E2E2E', 0.11, chart), chart, null, 'Supplementary grid: no automatic 3:1 requirement');
add('yellow_preset_line_and_wick', '#FACC15', chart, 3, 'Built-in preset retains yellow on forced light canvas');
add('yellow_preset_bear_fill', '#F8FAFC', chart, null, 'Check with its yellow outline, which also fails');
add('blue_preset_bull', '#4597FF', chart, 3);
add('blue_preset_bear', '#FF5858', chart, 3);
add('black_white_preset_hollow_fill', '#FFFFFF', chart, null, 'Black candle outline carries visibility');
add('black_white_preset_outline', '#000000', chart, 3);
add('sell_focus_outline', '#4338CA', '#DC2626', 3, 'Live computed inset outline; no separating shadow');
add('buy_focus_outline', '#4338CA', '#2563EB', 3, 'Source shares same inset focus selector');
add('focus_halo_on_white', composite('#4338CA', 0.15, '#FFFFFF'), '#FFFFFF', null, 'Supplementary halo; solid input border carries AA visibility');
const alertBackground = composite('#F87171', 0.06, '#FAFAFA');
add('market_watch_error_text', '#F87171', alertBackground, 4.5, 'Inline 10px text; displayed hex is rounded, calculation retains fractional channels');
add('suggested_market_watch_error_text', '#B91C1C', alertBackground, 4.5);
add('disabled_text_on_panel', '#9CA3AF', '#FAFAFA', null, 'Exempt only when truly inactive/decorative; not for meaningful live information');
add('panel_vs_canvas', '#FAFAFA', chart, null, 'Structural hierarchy, not text contrast');
add('white_vs_canvas', '#FFFFFF', chart, null, 'Structural hierarchy, not text contrast');
add('chrome_vs_panel', '#F2F4F8', '#FAFAFA', null);
add('selected_vs_panel', '#EEF2FF', '#FAFAFA', null, 'Selection needs its separate visible indicator');
add('structural_border_vs_panel', '#E3E8F0', '#FAFAFA', null, 'Decorative unless sole functional boundary');
add('structural_border_vs_canvas', '#E3E8F0', chart, null);
add('strong_border_vs_canvas', '#D1D5DB', chart, null);
add('default_bull_vs_bear', '#059669', '#DC2626', null, 'Passing vs background does not prove color-vision distinguishability');
add('profit_text_vs_loss_text', '#047857', '#B91C1C', null, 'Signs and labels preserve meaning');
add('blue_vs_indigo', '#2563EB', '#4338CA', null, 'Use labels and position, not hue alone');
for (const color of ['#FFFFFF','#FAFAFA','#F7F8FA','#F7F7F7','#F2F4F8']) {
  add(`luminance_reference:${color}`, '#111827', color, null);
}
for (const [role, foreground] of Object.entries({old_quote:'#0B6CF0',mobile_green:'#059669',mobile_muted:'#6B7280',mobile_loss:'#DC2626',mobile_bright:'#10B981',mobile_crosshair:'#94A3B8'})) {
  for (const [name,background] of Object.entries({white:'#FFFFFF',selected:'#EEF2FF',old_selected:'#E3E3E3',chart})) add(`historical_reference:${role}:${name}`, foreground, background, null, 'Historical/reference color; not evidence of current use');
}

const summary = {
  date:'2026-09-15', method:'WCAG 2.x standard sRGB relative luminance; alpha composited before calculation; unrounded thresholds',
  coreTextPairCount:corePairs, coreTextPassed:pairs.slice(0,corePairs).filter(p=>p.result==='PASS').length,
  coreTextMinima:Object.fromEntries(Object.keys(coreText).map(role=>[role,Math.min(...pairs.filter(p=>p.role.startsWith(`core_text:${role}:`)).map(p=>p.contrast))])),
  surfaceLuminances:Object.fromEntries(['#FFFFFF','#FAFAFA','#F7F8FA','#F7F7F7','#F2F4F8'].map(c=>[c,luminance(c)])),
  pairs,
};
fs.writeFileSync(path.join(directory,'contrast-results.json'), JSON.stringify(summary,null,2)+'\n');
const quote = value => '"'+String(value??'').replaceAll('"','""')+'"';
fs.writeFileSync(path.join(directory,'contrast-pairs.csv'), 'role,foreground,background,contrast,threshold,result,note\n'+pairs.map(p=>[p.role,p.foreground,p.background,p.contrast.toFixed(8),p.threshold,p.result,p.note].map(quote).join(',')).join('\n')+'\n');
console.log(JSON.stringify({...summary,pairs: pairs.filter(p=>!p.role.startsWith('core_text:')&&!p.role.startsWith('historical_reference:'))},null,2));
