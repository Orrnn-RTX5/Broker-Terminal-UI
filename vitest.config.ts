import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import testEnvironments from './config/vitest-environments.json'

const nodeTests = [...testEnvironments.logic, ...testEnvironments.presentation]

export const createTestConfig = (webOnly = false) => defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    testTimeout: 10000, // Increase timeout for slow tests
    // Explicitly audited files run without browser setup. New files retain the
    // existing UI environment until their dependencies have been reviewed.
    // All three projects remain part of `test:run`, including the CI command.
    // Keep include patterns in the projects because inherited arrays are merged.
    projects: [
      {
        extends: true,
        test: {
          name: 'logic',
          environment: 'node',
          setupFiles: [],
          include: testEnvironments.logic.filter(file => !webOnly || !/[^/]*(desktop|electron)[^/]*$/i.test(file)),
        },
      },
      {
        extends: true,
        test: {
          name: 'presentation',
          environment: 'node',
          setupFiles: [],
          include: testEnvironments.presentation.filter(file => !webOnly || !/[^/]*(desktop|electron)[^/]*$/i.test(file)),
        },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
          exclude: [
            ...configDefaults.exclude, ...nodeTests,
            ...(webOnly ? ['**/*[dD]esktop*', '**/*[eE]lectron*'] : []),
          ],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData/**',
        'dist/',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})

export default createTestConfig()
