#!/usr/bin/env node
/**
 * 从 web-platform-tests 仓库(pinned commit)拉取官方一致性测试资产:
 *   - url/resources/urltestdata.json → mp-url 全量一致性用例(T3)
 * 过滤出 http/https 用例(本仓库的实际暴露面)后落盘,
 * 并写入 pin 元数据,保证 CI 可复现、引擎升级可 diff。
 *
 * 用法:pnpm sync:wpt [--limit 2500]
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'

const REPO = 'web-platform-tests/wpt'
const OUT_DIR = new URL('../packages/mp-url/test/fixtures/', import.meta.url)
const PIN_FILE = new URL('wpt-pin.json', OUT_DIR)
const DATA_FILE = new URL('wpt-urltests.json', OUT_DIR)

const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : 5000

const SPECIAL = /^https?:/i // 只保留 http/https:传输桥与 EventSource 的实际暴露面

async function main() {
  process.stdout.write('解析 WPT 最新 commit…\n')
  const commitRes = await fetch(`https://api.github.com/repos/${REPO}/commits/master`, {
    headers: { 'user-agent': 'cornworld-miniprogram-polyfill' },
  })
  if (!commitRes.ok) throw new Error(`GitHub API ${commitRes.status}`)
  const { sha } = /** @type {{ sha: string }} */ (await commitRes.json())

  process.stdout.write(`下载 urltestdata.json @ ${sha.slice(0, 12)}…\n`)
  const dataRes = await fetch(
    `https://raw.githubusercontent.com/${REPO}/${sha}/url/resources/urltestdata.json`,
  )
  if (!dataRes.ok) throw new Error(`raw fetch ${dataRes.status}`)
  const all = /** @type {(string | import('./types').WptUrlCase)[]} */ (await dataRes.json())

  const relevant = all.filter((entry) => {
    if (typeof entry === 'string') return SPECIAL.test(entry)
    return SPECIAL.test(entry.input) || SPECIAL.test(entry.base ?? '')
  })
  const subset = relevant.slice(0, limit)

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(DATA_FILE, JSON.stringify(subset, null, 1))
  const previousPin = existsSync(PIN_FILE) ? JSON.parse(readFileSync(PIN_FILE, 'utf8')) : null
  const pin = {
    repo: REPO,
    sha,
    fetchedAt: new Date().toISOString(),
    total: all.length,
    kept: subset.length,
  }
  writeFileSync(PIN_FILE, JSON.stringify(pin, null, 2))

  process.stdout.write(
    `完成:${all.length} 条全量 → special schemes ${relevant.length} 条,保留 ${subset.length} 条` +
      (previousPin && previousPin.sha !== sha ? `(旧 pin ${previousPin.sha.slice(0, 12)})` : '') +
      '\n',
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
