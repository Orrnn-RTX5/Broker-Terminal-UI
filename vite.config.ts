import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    open: true,
    hmr: {
      host: '127.0.0.1',
      protocol: 'ws',
      clientPort: 5173,
    },
    proxy: {
      '/api': {
        target: 'https://backend.orrnn.com',
        changeOrigin: true,
        secure: true,
        // NOTE: ws:true removed — it caused 503s by intercepting HTTP requests
        // as WebSocket upgrades. WS connections use /fix-ws proxy below.
      },
      '/fix-ws': {
        target: 'wss://backend.orrnn.com',
        changeOrigin: true,
        secure: false,
        ws: true,
      }
    }
  },
  optimizeDeps: {
    include: ['lightweight-charts', 'html2canvas-pro'],
  }
})
