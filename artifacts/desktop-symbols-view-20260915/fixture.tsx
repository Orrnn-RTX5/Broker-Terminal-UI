import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/authenticatedStyles';
import { MenuBar } from '../../src/components/layout/MenuBar';
import { ThemeProvider } from '../../src/contexts/ThemeContext';
import '../../src/i18n';

// Isolated component preview on its own local port. No broker requests are sent.
window.electron = { window: {} } as Window['electron'];
const instruments = [
  ['XAUUSD.rtx', 'Gold / US Dollar', 'Commodities.Metals'],
  ['XAGUSD', 'Silver / US Dollar', 'Commodities.Metals'],
  ['EURUSD', 'Euro / US Dollar', 'Forex.Majors'],
  ['GBPUSD', 'British Pound / US Dollar', 'Forex.Majors'],
  ['USDJPY', 'US Dollar / Japanese Yen', 'Forex.Majors'],
  ['AUDUSD', 'Australian Dollar / US Dollar', 'Forex.Majors'],
  ['USDCAD', 'US Dollar / Canadian Dollar', 'Forex.Majors'],
  ['USDCHF', 'US Dollar / Swiss Franc', 'Forex.Majors'],
  ['NZDUSD', 'New Zealand Dollar / US Dollar', 'Forex.Majors'],
  ['EURGBP', 'Euro / British Pound', 'Forex.Crosses'],
  ['EURJPY', 'Euro / Japanese Yen', 'Forex.Crosses'],
  ['GBPJPY', 'British Pound / Japanese Yen', 'Forex.Crosses'],
  ['BTCUSD', 'Bitcoin / US Dollar', 'Crypto'],
  ['ETHUSD', 'Ethereum / US Dollar', 'Crypto'],
  ['NAS100', 'US Nasdaq 100 Index', 'Indices'],
].map(([symbol, description, category]) => ({ symbol, description, category, digits: 2, contract_size: 100, tick_size: 0.01, margin_currency: 'USD' }));
window.fetch = (async (input: RequestInfo | URL) => Response.json(
  String(input).includes('instruments') ? { instruments } : [],
)) as typeof fetch;

function Preview() {
  const [light, setLight] = useState(true);
  const [font, setFont] = useState<'small' | 'normal' | 'large'>('normal');
  const [focus, setFocus] = useState(false);
  const [openedChart, setOpenedChart] = useState('');
  useEffect(() => {
    document.documentElement.classList.add('rtx-desktop-shell-active');
    document.documentElement.classList.toggle('rtx-advanced-view', light);
    document.documentElement.classList.toggle('rtx-skin-untitled-light', light);
    document.documentElement.classList.toggle('rtx-advanced-font-small', font === 'small');
    document.documentElement.classList.toggle('rtx-advanced-font-large', font === 'large');
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
  }, [light, font]);
  useEffect(() => {
    const handleChart = (event: Event) => setOpenedChart((event as CustomEvent).detail.symbol);
    window.addEventListener('openChart', handleChart);
    return () => window.removeEventListener('openChart', handleChart);
  }, []);
  return <ThemeProvider>
    <style>{`html, body, #root { background: var(--bg-primary); color: var(--text-primary); }
      .preview-toolbar { display:flex; gap:12px; align-items:center; padding:16px; border-top:1px solid var(--border-primary); }
      .preview-toolbar button { padding:8px 12px; border:1px solid var(--border-secondary); border-radius:6px; }
      .preview-caption { position:fixed; bottom:16px; left:20px; color:var(--text-secondary); }
    `}</style>
    <div style={{ height: 32 }}><MenuBar advancedViewEnabled={light} advancedFontSize={font} focusChart={focus}
      onSetAdvancedViewEnabled={setLight} onSetAdvancedFontSize={setFont} onSetFocusChart={setFocus} /></div>
    <div className="preview-toolbar">
      <button onClick={() => window.dispatchEvent(new CustomEvent('openSymbolsDialog'))}>Open Symbols</button>
      <button onClick={() => setLight(value => !value)}>{light ? 'Preview dark theme' : 'Preview light theme'}</button>
      <span>Font: {font} · Focus chart: {focus ? 'on' : 'off'}</span>
    </div>
    <div className="preview-caption">Desktop component preview · Sample instrument catalog{openedChart && <output> · Opened chart: {openedChart}</output>}</div>
  </ThemeProvider>;
}

createRoot(document.getElementById('root')!).render(<Preview />);
