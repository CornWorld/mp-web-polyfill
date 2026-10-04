import { readFileSync } from 'node:fs'
import { defineConfig, type Options } from 'tsup'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

const shared: Pick<Options, 'format' | 'target' | 'sourcemap' | 'dts' | 'define'> = {
  format: ['esm', 'cjs'],
  target: 'es2020',
  sourcemap: true,
  dts: false,
  define: { __PKG_VERSION__: JSON.stringify(pkg.version) },
}

/**
 * 一线路构建:默认唯一入口 src/index.ts,每格式一个真 bundle,所有子路径
 * 出口在 package.json 中指向同一份产物,跨出口只有一份类与单例(CJS 无法
 * 做共享 chunk,多入口必然内联副本 —— 单 bundle 是 CJS 下保证同一性的唯一形态)。
 *
 * 例外:`./url/idna`(tr46 数据表 ~213KB)与 `./streams/full`(web-streams
 * ~62KB)是按需增强的独立 bundle —— 必须与主模块图隔离,否则任何子路径
 * 消费方都会被迫携带;也因此这两个重依赖不出现在默认 bundle 中。
 */
export default [
  defineConfig({
    ...shared,
    entry: { index: 'src/index.ts' },
    clean: false,
  }),
  defineConfig({
    ...shared,
    entry: { idna: 'src/url/idna.ts' },
    clean: false,
    banner: {
      js: '// mp-web-polyfill/url/idna —— 全量 IDNA 域名引擎(UTS46/tr46),import 即安装;默认 lite 引擎见 ./url',
    },
  }),
  defineConfig({
    ...shared,
    entry: { 'streams-full': 'src/fetch/streams-full.ts' },
    clean: false,
    banner: {
      js: '// mp-web-polyfill/streams/full —— 完整 WHATWG Streams 引擎(web-streams-polyfill),import 即注入;默认最小实现见 ./fetch',
    },
  }),
]
