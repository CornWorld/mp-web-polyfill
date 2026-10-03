import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { URL } from '@cornworld/mp-url'

// ———— T3:whatwg-url 全量一致性(urltestdata.json,数据驱动) ————
// 资产来源:WPT 官方(pinned commit 见 wpt-pin.json),`pnpm sync:wpt` 刷新。
// 门禁语义:
//   - 基线内的已知偏差 → skip(不红);
//   - 基线外的新偏差 → 红(引擎升级回归);
//   - 基线条目全部通过 → 红(偏差消失,请刷新基线);
//   - 刷新基线:UPDATE_URL_BASELINE=1 pnpm vitest run packages/mp-url

const DATA_FILE = fileURLToPath(new URL('./fixtures/wpt-urltests.json', import.meta.url))
const BASELINE_FILE = fileURLToPath(new URL('./fixtures/wpt-known-failures.json', import.meta.url))
const UPDATE = process.env.UPDATE_URL_BASELINE === '1'

interface WptUrlCase {
  input: string
  base?: string | null
  failure?: boolean
  expected?: Record<string, string>
}

const caseKey = (c: WptUrlCase) => `${c.base ?? ''} ← ${c.input}`

if (!existsSync(DATA_FILE)) {
  describe.skip('urltestdata.json 全量一致性(资产未下载)', () => {
    it.todo('运行 pnpm sync:wpt 生成')
  })
} else {
  const pinFile = fileURLToPath(new URL('./fixtures/wpt-pin.json', import.meta.url))
  const pin = existsSync(pinFile) ? (JSON.parse(readFileSync(pinFile, 'utf8')) as { sha: string }) : null
  const baseline = existsSync(BASELINE_FILE)
    ? (JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as string[])
    : []
  const cases = JSON.parse(readFileSync(DATA_FILE, 'utf8')) as (string | WptUrlCase)[]

  describe(`urltestdata.json 全量一致性(whatwg-url,pin ${pin?.sha.slice(0, 12) ?? '?'}),${cases.length} 例`, () => {
    const failingKeys: string[] = []
    const passingKeys = new Set<string>()

    for (const raw of cases) {
      const c: WptUrlCase = typeof raw === 'string' ? { input: raw } : raw
      const key = caseKey(c)
      const knownDeviation = !UPDATE && baseline.includes(key)

      it.skipIf(knownDeviation)(key, () => {
        let error: unknown
        try {
          const url = new URL(c.input, c.base ?? undefined)
          if (c.failure) throw new Error('应当抛出,但解析成功')
          const expected = c.expected ?? {}
          const actual = url as unknown as Record<string, unknown>
          for (const [prop, value] of Object.entries(expected)) {
            if (value === undefined) continue
            expect(actual[prop], `${key} 的 ${prop}`).toBe(value)
          }
        } catch (err) {
          // failure:true 的用例抛错 = 符合预期,不算偏差
          if (c.failure) {
            passingKeys.add(key)
            return
          }
          error = err
        }
        if (error !== undefined) failingKeys.push(key)
        else passingKeys.add(key)
        expect(error, key).toBeUndefined()
      })
    }

    it('升级回归门(基线比对)', () => {
      if (UPDATE) {
        writeFileSync(BASELINE_FILE, JSON.stringify(failingKeys, null, 2))
        console.warn(`已刷新基线:${failingKeys.length} 条已知偏差 → wpt-known-failures.json`)
        return
      }
      const newDeviations = failingKeys.filter((key) => !baseline.includes(key))
      const stale = baseline.filter((key) => !failingKeys.includes(key) && passingKeys.has(key))
      expect(newDeviations, '引擎出现基线外的新偏差(升级回归);确认后 UPDATE_URL_BASELINE=1 刷新基线').toEqual([])
      expect(stale, '基线中的偏差已消失,请 UPDATE_URL_BASELINE=1 刷新基线').toEqual([])
    })
  })
}
