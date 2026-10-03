import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 公共导入面契约:package.json exports 的每个子路径必须可被真实解析
 * (cjs require 成功)且 import/types/require 三条件指向的产物文件存在。
 * 防「映射写错顶层平铺 / 嵌套目录」这类 Node 侧测试(走 src 别名)发现
 * 不了、只有消费方打包时才爆的破损(2026-10-03 实测:exports 指向
 * dist/<area>/index.js 而 tsup 产 dist/<area>.js,rolldown 解析失败)。
 * 前置:先 pnpm build(CI 顺序 typecheck→build→test 满足)。
 */
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../')
const exportsMap = JSON.parse(readFileSync(resolve(pkgRoot, 'package.json'), 'utf8'))
  .exports as Record<string, Record<string, string>>
const req = createRequire(resolve(pkgRoot, 'package.json'))

describe('exports 子路径契约', () => {
  const subpaths = Object.keys(exportsMap).filter((k) => k !== './package.json')

  it('公共子路径不少于 10 个', () => {
    expect(subpaths.length).toBeGreaterThanOrEqual(10)
  })

  for (const sub of subpaths) {
    it(`${sub}:cjs 可解析,三条件产物存在`, () => {
      const mod = req(`mp-web-polyfill/${sub.slice(2)}`)
      expect(Object.keys(mod).length).toBeGreaterThan(0)
      for (const target of [
        exportsMap[sub].import,
        exportsMap[sub].types,
        exportsMap[sub].require,
      ]) {
        expect(existsSync(resolve(pkgRoot, target)), target).toBe(true)
      }
    })
  }
})
