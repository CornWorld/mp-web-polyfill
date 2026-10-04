import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 公共导入面契约(一线路产物形态)。
 * 1. package.json exports 的每个子路径必须可被真实解析(cjs require 成功),
 *    且 import/types/require 三条件指向的产物文件存在。这防的是「映射写错」类
 *    Node 侧测试(走 src 别名)发现不了、只有消费方打包时才爆的破损
 * 2. 所有子路径解析到同一份 bundle(esm/cjs 皆然), 一线路构建的核心保证:
 *    跨出口只有一份类与单例, installer 安装的 Headers 与 ./fetch 导出的
 *    Headers 必然同源(CJS 多入口构建曾把共享模块内联成两份副本,
 *    跨入口 instanceof 全断, 2026-10-04 修复)
 * 前置: 先 pnpm build(CI 顺序 typecheck→build→test 满足)。
 */
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../')
const exportsMap = JSON.parse(readFileSync(resolve(pkgRoot, 'package.json'), 'utf8'))
  .exports as Record<string, Record<string, string>>
const req = createRequire(resolve(pkgRoot, 'package.json'))

describe('exports 子路径契约(单 bundle 同源)', () => {
  const subpaths = Object.keys(exportsMap).filter((k) => k !== './package.json' && k !== '.')
  // 一线路的例外: ./url/idna(tr46 数据表 ~213KB)与 ./streams/full
  // (web-streams ~62KB)是按需增强的独立 bundle, 必须与主模块图隔离,
  // 否则所有子路径消费方都会被迫携带。
  const SECONDARY_BUNDLES: Record<string, { import: string; require: string }> = {
    './url/idna': { import: './dist/idna.js', require: './dist/idna.cjs' },
    './streams/full': { import: './dist/streams-full.js', require: './dist/streams-full.cjs' },
  }
  const mainSubpaths = subpaths.filter((sub) => !(sub in SECONDARY_BUNDLES))

  it('公共子路径不少于 10 个', () => {
    expect(subpaths.length).toBeGreaterThanOrEqual(10)
  })

  for (const sub of subpaths) {
    it(`${sub}:cjs 可解析,三条件产物存在`, () => {
      const entry = exportsMap[sub]
      if (!entry) throw new Error(`exports 缺少 ${sub} 映射`)
      const mod = req(`mp-web-polyfill/${sub.slice(2)}`)
      expect(Object.keys(mod).length).toBeGreaterThan(0)
      for (const target of [entry.import, entry.types, entry.require]) {
        if (!target) throw new Error(`exports ${sub} 三条件不完整`)
        expect(existsSync(resolve(pkgRoot, target)), target).toBe(true)
      }
    })
  }

  it('exports 映射:主 bundle 子路径同源,idna 独立(一线路契约)', () => {
    for (const sub of mainSubpaths) {
      const entry = exportsMap[sub]
      if (!entry) throw new Error(`exports 缺少 ${sub} 映射`)
      expect(entry.import, `${sub} import`).toBe('./dist/index.js')
      expect(entry.require, `${sub} require`).toBe('./dist/index.cjs')
    }
    for (const [sub, expected] of Object.entries(SECONDARY_BUNDLES)) {
      const entry = exportsMap[sub]
      if (!entry) throw new Error(`exports 缺少 ${sub} 映射`)
      expect(entry.import, `${sub} import`).toBe(expected.import)
      expect(entry.require, `${sub} require`).toBe(expected.require)
    }
  })

  it('tr46 / web-streams 不进入主 bundle,只随各自开关子路径携带', () => {
    const indexSource = readFileSync(resolve(pkgRoot, './dist/index.js'), 'utf8')
    expect(indexSource.includes('toASCII'), '主 bundle 不应含 tr46 的 toASCII').toBe(false)
    expect(indexSource.includes('tr46'), '主 bundle 不应引用 tr46').toBe(false)
    expect(
      indexSource.includes('web-streams-polyfill'),
      '主 bundle 不应引用 web-streams-polyfill',
    ).toBe(false)
    expect(readFileSync(resolve(pkgRoot, './dist/idna.cjs'), 'utf8').includes('tr46')).toBe(true)
    expect(
      readFileSync(resolve(pkgRoot, './dist/streams-full.cjs'), 'utf8').includes(
        'web-streams-polyfill',
      ),
    ).toBe(true)
  })

  it('cjs:主 bundle 所有子路径解析到同一份 module(单实例)', () => {
    const first = req('mp-web-polyfill/fetch')
    for (const sub of mainSubpaths) {
      expect(req(`mp-web-polyfill/${sub.slice(2)}`), sub).toBe(first)
    }
    expect(first.Headers).toBeTypeOf('function')
    expect(first.localStorage).toBeTypeOf('object')
  })

  it('cjs:installer 与子路径导出同一份类/单例', () => {
    const fetchNs = req('mp-web-polyfill/fetch')
    const installerNs = req('mp-web-polyfill/installer')
    const storageNs = req('mp-web-polyfill/storage')
    expect(installerNs.Headers).toBe(fetchNs.Headers)
    expect(installerNs.localStorage).toBe(storageNs.localStorage)
    expect(installerNs.EventSource).toBe(req('mp-web-polyfill/eventsource').EventSource)
    expect(installerNs.URL).toBe(req('mp-web-polyfill/url').URL)
  })

  it('esm:dist 入口含全部公共导出(冒烟;动态文件 URL 导入不依赖构建期的 TS 解析)', async () => {
    const mod = (await import(pathToFileURL(resolve(pkgRoot, './dist/index.js')).href)) as Record<
      string,
      unknown
    >
    for (const name of [
      'fetch',
      'Headers',
      'Request',
      'Response',
      'FormData',
      'Blob',
      'EventSource',
      'URL',
      'URLSearchParams',
      'TextEncoder',
      'TextDecoder',
      'localStorage',
      'installWebRuntimeGlobals',
    ]) {
      expect(mod[name], name).toBeDefined()
    }
  })
})
