import { createTestConfig } from './vitest.config'

// Retain shared web behavior tests; omit explicitly desktop-only test files.
export default createTestConfig(true)
