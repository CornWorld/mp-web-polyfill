import { defineConfig } from 'tsup'

/**
 * 单包多出口:每个子路径一个入口(tsup 产 js,tsc 产 d.ts)。
 * 输出位置与 package.json exports 一一对应:
 *   dist/core.js + dist/core/index.d.ts → ./core
 *   dist/fetch/abort.js + dist/fetch/abort.d.ts → ./fetch/abort
 */
export default defineConfig({
  entry: {
    core: 'src/core/index.ts',
    'text-encoding': 'src/text-encoding/index.ts',
    url: 'src/url/index.ts',
    storage: 'src/storage/index.ts',
    fetch: 'src/fetch/index.ts',
    'fetch/abort': 'src/fetch/abort.ts',
    'fetch/form-data': 'src/fetch/form-data.ts',
    'fetch/streams': 'src/fetch/streams.ts',
    eventsource: 'src/eventsource/index.ts',
    installer: 'src/installer/index.ts',
  },
  format: ['esm', 'cjs'],
  target: 'es2020',
  clean: true,
  sourcemap: true,
  dts: false,
})
