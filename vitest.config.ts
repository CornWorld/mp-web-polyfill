import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// 测试跑在源码层:包内互相 import 已是相对路径,别名只剩 wx-mock。
export default defineConfig({
  resolve: {
    alias: {
      '@cornworld/wx-mock': fileURLToPath(
        new URL('./internal/wx-mock/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: [
      'packages/**/test/**/*.test.ts',
      'internal/**/test/**/*.test.ts',
      'tools/**/*.test.ts',
    ],
    testTimeout: 15000,
  },
})
