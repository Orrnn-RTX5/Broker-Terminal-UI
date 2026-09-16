import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: path.resolve(fixtureDir, '../..'),
  envDir: fixtureDir,
  cacheDir: path.join(fixtureDir, 'vite-cache'),
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5189, strictPort: true, hmr: false },
  optimizeDeps: { entries: ['artifacts/desktop-broker-loading-20260915/fixture.tsx'] },
});
