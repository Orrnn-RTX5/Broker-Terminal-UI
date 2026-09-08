import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  environment: 'jsdom',
  include: ['artifacts/fib-trend-value-audit-20260908/values.test.ts'],
} });
