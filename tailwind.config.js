/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        profit: '#39FF14',
        loss: '#FF3333',
        primary: '#2196F3',
        warning: '#FFA726',
        info: '#26C6DA',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['Roboto Mono', 'Courier New', 'monospace'],
      },
      fontSize: {
        '2xs': '0.625rem', // 10px
      },
      animation: {
        'flash-profit': 'flash-profit 200ms ease-out',
        'flash-loss': 'flash-loss 200ms ease-out',
        'pulse-glow': 'pulse-glow 1000ms ease-in-out infinite',
        'skeleton-shimmer': 'skeleton-shimmer 1.5s ease-in-out infinite',
      },
      keyframes: {
        'flash-profit': {
          '0%': { backgroundColor: 'transparent' },
          '50%': { backgroundColor: 'rgba(0, 200, 83, 0.125)' },
          '100%': { backgroundColor: 'transparent' },
        },
        'flash-loss': {
          '0%': { backgroundColor: 'transparent' },
          '50%': { backgroundColor: 'rgba(255, 82, 82, 0.125)' },
          '100%': { backgroundColor: 'transparent' },
        },
        'pulse-glow': {
          '0%, 100%': {
            opacity: '1',
            boxShadow: '0 0 8px currentColor',
          },
          '50%': {
            opacity: '0.7',
            boxShadow: '0 0 16px currentColor',
          },
        },
        'skeleton-shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      boxShadow: {
        'glow-profit': '0 0 20px rgba(0, 200, 83, 0.125)',
        'glow-loss': '0 0 20px rgba(255, 82, 82, 0.125)',
        'glow-primary': '0 0 20px rgba(33, 150, 243, 0.125)',
      },
    },
  },
  plugins: [],
}
