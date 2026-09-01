import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AppShell from './AppShell';
import { DesktopWindowShell } from './components/layout/DesktopWindowShell';
import { ThemeProvider } from './contexts/ThemeContext';

export const mountApp = () => {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error("Root element 'root' not found in document");
  }

  const root = createRoot(rootElement);
  root.render(
    <StrictMode>
      <ThemeProvider>
        <DesktopWindowShell>
          <AppShell />
        </DesktopWindowShell>
      </ThemeProvider>
    </StrictMode>,
  );
};
