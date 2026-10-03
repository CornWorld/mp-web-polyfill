import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setReadableStreamClass, isStreamingSupported } from '../../src/fetch'
import {
  ALL_TARGETS,
  POLYFILL_MARKER,
  installWebRuntimeGlobals,
  listGlobalsStatus,
} from '../../src/installer'

const g = globalThis as unknown as Record<string, unknown>

// Node 24 自带 fetch/URL/FormData 等原生实现:测试前保存,测试后还原,
// 使每个用例都在“裸环境”上断言(真机小程序同样只有 wx,没有这些全局)
const originals = Object.fromEntries(ALL_TARGETS.map((name) => [name, g[name]]))

beforeEach(() => {
  for (const name of ALL_TARGETS) delete g[name]
  setReadableStreamClass(undefined as never)
})

afterEach(() => {
  for (const name of ALL_TARGETS) {
    if (originals[name] === undefined) delete g[name]
    else g[name] = originals[name]
  }
  setReadableStreamClass(originals.ReadableStream as never)
})

describe('installWebRuntimeGlobals(API 级安装器)', () => {
  it('全新环境:全量 installed + 全局生效 + 打上家族标记', () => {
    const report = installWebRuntimeGlobals()
    expect(report.installed.sort()).toEqual([...ALL_TARGETS].sort())
    expect(typeof g.fetch).toBe('function')
    expect((g.Headers as Record<symbol, unknown>)[POLYFILL_MARKER]).toBeDefined()
    expect((g.localStorage as Record<symbol, unknown>)[POLYFILL_MARKER]).toBeDefined()
  })

  it('重复安装幂等:全部 skipped', () => {
    installWebRuntimeGlobals()
    const second = installWebRuntimeGlobals()
    expect(second.installed).toHaveLength(0)
    expect(second.skipped.sort()).toEqual([...ALL_TARGETS].sort())
  })

  it('宿主/他库已存在的实现默认不覆盖,force 才接管', () => {
    class FakeURL {
      static canParse() {
        return false
      }
    }
    g.URL = FakeURL
    const withoutForce = installWebRuntimeGlobals({ targets: ['URL'] })
    expect(withoutForce.skipped).toEqual(['URL'])
    expect(g.URL).toBe(FakeURL)

    const withForce = installWebRuntimeGlobals({ targets: ['URL'], force: true })
    expect(withForce.replaced).toEqual(['URL'])
    expect(g.URL).not.toBe(FakeURL)
  })

  it('API 级粒度:targets 只装指定项', () => {
    const report = installWebRuntimeGlobals({ targets: ['fetch', 'EventSource'] })
    expect(report.installed).toEqual(['fetch', 'EventSource'])
    expect(g.Headers).toBeUndefined()
  })

  it('安装 ReadableStream 后自动接通 fetch 流式通道', () => {
    expect(isStreamingSupported()).toBe(false)
    installWebRuntimeGlobals({ targets: ['ReadableStream'] })
    expect(isStreamingSupported()).toBe(true)
  })

  it('listGlobalsStatus 反映安装来源', () => {
    expect(listGlobalsStatus().every((s) => s.source === 'absent')).toBe(true)
    installWebRuntimeGlobals({ targets: ['TextDecoder'] })
    expect(listGlobalsStatus().find((s) => s.name === 'TextDecoder')?.source).toBe('ours')
    expect(listGlobalsStatus().find((s) => s.name === 'URL')?.source).toBe('absent')
  })
})
