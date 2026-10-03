// 探针页模板:复制进目标小程序工程(或由其页面引用本逻辑)。
// 契约:向 globalThis 注册 __mpProbeRun(),供 tools/probe/run.mjs 经
// miniprogram-automator 的 evaluate() 拉取结果。
//
// 工程需引入:
//   pnpm add @cornworld/mp-web-runtime
// 并在 app.json 依赖 npm 构建(weapp-vite 原生支持 node_modules 打包)。

import { installWebRuntimeGlobals } from '@cornworld/mp-web-runtime'

Page({
  data: {
    report: null as string | null,
  },
  onLoad() {
    const report = installWebRuntimeGlobals()

    const checks = [
      { name: 'fetch-global', ok: typeof fetch === 'function' },
      { name: 'eventsource-global', ok: typeof EventSource === 'function' },
      {
        name: 'url-parse',
        ok: (() => {
          try {
            return new URL('http://example.com/a/./b').href === 'http://example.com/a/b'
          } catch {
            return false
          }
        })(),
      },
      {
        name: 'utf8-decode',
        ok: new TextDecoder().decode(new Uint8Array([0xe5, 0xb0, 0x8f])) === '小',
      },
      {
        name: 'storage-roundtrip',
        ok: (() => {
          try {
            localStorage.setItem('__probe__', '1')
            const value = localStorage.getItem('__probe__')
            localStorage.removeItem('__probe__')
            return value === '1'
          } catch {
            return false
          }
        })(),
      },
    ]

    // 展示 + 供 evaluate 拉取
    this.setData({ report: JSON.stringify({ report, checks }, null, 2) })
    ;(globalThis as unknown as Record<string, unknown>).__mpProbeRun = () => ({
      report,
      checks,
    })
  },
})
