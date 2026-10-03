import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))

// 测试全部跑在源码层:workspace 包别名指向 src,不依赖先构建 dist
export default defineConfig({
  resolve: {
    alias: {
      '@cornworld/mp-core': pkg('mp-core'),
      '@cornworld/mp-text-encoding': pkg('mp-text-encoding'),
      '@cornworld/mp-url': pkg('mp-url'),
      '@cornworld/mp-fetch': pkg('mp-fetch'),
      '@cornworld/mp-eventsource': pkg('mp-eventsource'),
      '@cornworld/mp-storage': pkg('mp-storage'),
      '@cornworld/mp-web-runtime': pkg('mp-web-runtime'),
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
