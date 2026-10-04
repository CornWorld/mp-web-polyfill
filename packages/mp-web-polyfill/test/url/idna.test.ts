import { readFileSync } from 'node:fs'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { installIdnaDomainEngine } from '../../src/url/idna'
import { URL } from '../../src/url'

/**
 * ./url/idna:全量 IDNA 域名引擎(UTS46/tr46,独立 bundle,import 即安装)。
 * 默认 lite 引擎对非 ASCII 域名判失败(小程序合法域名为 ASCII), 本文件
 * 在安装全量引擎后,用 WPT 语料的非 ASCII 用例验证行为恢复与上游一致。
 * 本文件与 wpt-corpus.test.ts 隔离运行(vitest 按文件隔离),不影响其他
 * 测试文件的 lite 默认语义。
 */

interface WptUrlCase {
  input: string
  base?: string | null
  failure?: boolean
  expected?: Record<string, string>
}

const caseKey = (c: WptUrlCase) => `${c.base ?? ''} ← ${c.input}`

/**
 * tr46 引擎级已知偏差(7 条, 与上游 whatwg-url@14.2.0 完全一致)。
 * WPT 已放宽 invalid-punycode 主机的校验(期望原样通过), tr46 的
 * UTS46 处理仍判失败。lite 引擎恰好因 ASCII 直通而通过这些用例,
 * 全量 IDNA 反而暴露差异。该集合与引擎升级无关, 属上游行为。
 */
const TR46_ENGINE_DEVIATIONS = [
  ' ← http://a.b.c.xn--pokxncvks',
  ' ← http://10.0.0.xn--pokxncvks',
  ' ← http://a.b.c.XN--pokxncvks',
  ' ← http://a.b.c.Xn--pokxncvks',
  ' ← http://10.0.0.XN--pokxncvks',
  ' ← http://10.0.0.xN--pokxncvks',
  ' ← https://xn--/',
]

const DATA_FILE = fileURLToPath(new NodeURL('./fixtures/wpt-urltests.json', import.meta.url))
const BASELINE_FILE = fileURLToPath(
  new NodeURL('./fixtures/wpt-known-failures.json', import.meta.url),
)
const cases = JSON.parse(readFileSync(DATA_FILE, 'utf8')) as (string | WptUrlCase)[]
const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as string[]

// 安装全量引擎(import 本模块已自动安装,这里显式调用兼测幂等)
installIdnaDomainEngine()

const hasNonAscii = (s: string) => [...s].some((ch) => (ch.codePointAt(0) ?? 0) > 0x7f)

const nonAsciiCases = cases.filter((raw): raw is WptUrlCase => {
  if (typeof raw === 'string' || raw.failure) return false
  const key = caseKey(raw)
  if (baseline.includes(key) || TR46_ENGINE_DEVIATIONS.includes(key)) return false
  const hasNonAsciiInput = hasNonAscii(raw.input) || hasNonAscii(raw.base ?? '')
  const expectsPunycode = `${raw.expected?.host ?? ''}${raw.expected?.hostname ?? ''}`.includes(
    'xn--',
  )
  return hasNonAsciiInput || expectsPunycode
})

describe('./url/idna(全量 IDNA 增强,import 即安装)', () => {
  it('幂等:重复安装不抛错', () => {
    expect(() => {
      installIdnaDomainEngine()
      installIdnaDomainEngine()
    }).not.toThrow()
  })

  it('非 ASCII 域名转 punycode(WPT 语义,lite 引擎下会判失败)', () => {
    expect(new URL('http://www.bücher.de/').host).toBe('www.xn--bcher-kva.de')
  })

  it(`WPT 语料非 ASCII 用例(${nonAsciiCases.length} 例,排除基线)全部通过`, () => {
    expect(nonAsciiCases.length).toBeGreaterThan(0)
    for (const c of nonAsciiCases) {
      const url = new URL(c.input, c.base ?? undefined)
      const actual = url as unknown as Record<string, unknown>
      for (const [prop, value] of Object.entries(c.expected ?? {})) {
        if (value === undefined) continue
        expect(actual[prop], `${caseKey(c)} 的 ${prop}`).toBe(value)
      }
    }
  })
})
