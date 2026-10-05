import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
  dependencies: Record<string, string>
}

/**
 * 一线路构建: 每格式(esm/cjs)一个真 bundle, 所有子路径出口在 package.json
 * 中指向同一份产物, 跨出口只有一份类与单例(CJS 无法做共享 chunk, 多入口
 * 必然内联副本, 单 bundle 是 CJS 下保证同一性的唯一形态)。
 *
 * 例外: `./url/idna`(tr46 数据表 ~213KB)与 `./streams/full`(web-streams
 * ~62KB)是按需增强的独立 bundle, 必须与主模块图隔离, 因此各自单独跑一次
 * vite build(多入口会被 rollup 抽公共 chunk, 破坏隔离)。三种构建都不清空
 * dist, 由 package.json 的 build 脚本统一先删后建。
 *
 * vite build           → dist/index.js + dist/index.cjs(全部默认子路径)
 * vite build --mode idna          → dist/idna.js + dist/idna.cjs
 * vite build --mode streams-full  → dist/streams-full.js + dist/streams-full.cjs
 */

const entries = {
  index: 'src/index.ts',
  idna: 'src/url/idna.ts',
  'streams-full': 'src/fetch/streams-full.ts',
} as const

const banners: Partial<Record<keyof typeof entries, string>> = {
  idna: '// mp-web-polyfill/url/idna —— 全量 IDNA 域名引擎(UTS46/tr46),import 即安装;默认 lite 引擎见 ./url',
  'streams-full':
    '// mp-web-polyfill/streams/full —— 完整 WHATWG Streams 引擎(web-streams-polyfill),import 即注入;默认最小实现见 ./fetch',
}

export default defineConfig(({ mode }) => {
  const key = (mode in entries ? mode : 'index') as keyof typeof entries
  const entry = entries[key]
  return {
    build: {
      target: 'es2020',
      sourcemap: true,
      emptyOutDir: false,
      lib: {
        entry,
        formats: ['es', 'cjs'],
        fileName: (format) => (format === 'es' ? `${key}.js` : `${key}.cjs`),
      },
      rollupOptions: {
        // 字符串形式下 rollup 自带「裸名 + 子路径」匹配, 不漏 web-streams-polyfill/es2018 之类
        external: Object.keys(pkg.dependencies),
        output: {
          banner: banners[key],
        },
      },
    },
    define: {
      __PKG_VERSION__: JSON.stringify(pkg.version),
    },
  }
})
