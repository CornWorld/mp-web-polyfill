#!/usr/bin/env node
/**
 * C 层探针 runner:驱动微信开发者工具,在真实小程序逻辑层里
 * 复跑与 Node 侧同一语义的检查用例,产出 probe-report.json。
 *
 * 前置(一次性):
 *   1. 已安装微信开发者工具,并在 设置→安全 开启「服务端口」;
 *   2. DevTools 已登录(登录态持久化,过期重新扫码一次);
 *   3. 目标小程序工程已安装 @cornworld/mp-web-runtime 并含探针页
 *      (模板见 tools/probe/probe-page/)。
 *
 * 用法:
 *   node tools/probe/run.mjs --project <小程序工程路径> \
 *     [--page pages/probe/index] [--cli <devtools cli>] [--report probe-report.json]
 */
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import automator from 'miniprogram-automator'

const execFileAsync = promisify(execFile)

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '')
    const next = argv[i + 1]
    // 无值 flag(--close/--build-npm):后随 token 以 -- 开头或缺省时按布尔处理,
    // 否则成对的 key-value 会被 flag 吃掉一个(本次 --pb 被 --build-npm 吞掉,实测)
    if (next === undefined || next.startsWith('--')) {
      out[key] = true
    } else {
      out[key] = next
      i++
    }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
// env 回退(PROBE_PROJECT/PROBE_PAGE)供 self-hosted runner 的 schedule 触发使用:
// 定时任务无法携带 inputs,runner 侧配置环境变量即可指向目标小程序工程。
const projectPath = resolve(args.project ?? process.env.PROBE_PROJECT ?? '.')
const pagePath = args.page ?? process.env.PROBE_PAGE ?? 'pages/probe/index'
const cliPath = args.cli ?? '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
const reportFile = args.report ?? 'probe-report.json'
const wsPort = args.ws ?? '9420'
const closeAfterRun = process.argv.includes('--close')
const npmBuild = process.argv.includes('--build-npm')
// --fresh:先 cli quit 再 launch —— 代码变更后常驻实例可能卡在半编译态
// (实测重编译 × 导航竞速可致页面崩、契约不注册),CI/构建后必用。
const freshSession = process.argv.includes('--fresh')
// --pb <base>:透传给探针页,启用「包装 SDK 全链路 demo」检查组
// (如 Docker PB:http://127.0.0.1:8091)
const demoPbBase = args.pb

/**
 * 会话获取:优先 connect 到常驻实例 —— 复用已打开的开发者工具,全程零弹窗;
 * 连不上才 launch(本机仅此一次开窗,之后 disconnect 保留实例供下次复用)。
 * Docker 方案不可行:官方无 Linux 版 DevTools,非官方 wine/移植链路脆弱,
 * 常驻实例 + connect 是官方推荐的无扰形态。
 */
async function openSession() {
  const wsEndpoint = `ws://127.0.0.1:${wsPort}`
  if (!freshSession) {
    try {
      const mini = await automator.connect({ wsEndpoint })
      console.log(`复用常驻开发者工具会话:${wsEndpoint}`)
      return mini
    } catch {
      // 无常驻会话,走 launch
    }
  } else {
    console.log('--fresh:先退出既有实例(代码变更后常驻实例可能处于半编译态)…')
    await execFileAsync(cliPath, ['quit']).catch(() => null)
    await new Promise((r) => setTimeout(r, 3000))
  }
  console.log(`拉起开发者工具(自动化端口 ${wsPort})…`)
  return automator.launch({ cliPath, projectPath, port: Number(wsPort) })
}

/**
 * DevTools npm 构建(miniprogram_npm)。DevTools 是单实例架构:cli build-npm
 * 会路由进已运行实例 —— 因此必须在会话建立之后调用(先 build-npm 后 launch
 * 会因实例已占服务端口而 launch 失败);也绝不能 pkill "清理",那杀的是同一
 * 个常驻实例。构建触发重编译,随后的页面导航即加载新 bundle。
 */
async function buildNpmInSession() {
  if (!npmBuild) return
  console.log('DevTools npm 构建(路由进当前实例)…')
  // 成败以进程退出码为准(execFileAsync 非零退出会 reject);stdout 是
  // { cost, warnings } 形态的 JSON,没有 code 字段
  const { stdout } = await execFileAsync(cliPath, ['build-npm', '--project', projectPath], {
    timeout: 120_000,
  })
  const parsed = JSON.parse(stdout || '{}')
  if (parsed.warnings?.length) {
    console.log(`npm 构建 warning ${parsed.warnings.length} 条(link: 包入口提示,可忽略)`)
  }
}
/** 本机真实 http 服务:供 DevTools 以真实 wx.request 直连(关闭域名校验) */
function startLocalServer() {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname === '/json') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, via: 'wx.request' }))
        return
      }
      if (url.pathname === '/sse') {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('retry: 100\n\n')
        res.write('data: 你好\n\n')
        res.write('id: 7\ndata: sse\n\n')
        res.end()
        return
      }
      if (url.pathname === '/utf8-split') {
        // 跨 chunk 截断多字节字符:第 1 字节单独成块,验证 TextDecoder({stream:true}) 增量重组
        const bytes = Buffer.from('小码')
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
        res.write(bytes.subarray(0, 1))
        setTimeout(() => res.write(bytes.subarray(1, 4)), 150)
        setTimeout(() => {
          res.write(bytes.subarray(4))
          res.end()
        }, 300)
        return
      }
      res.writeHead(404)
      res.end()
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolvePromise({ server, origin: `http://127.0.0.1:${port}` })
    })
  })
}

async function main() {
  const { server, origin } = await startLocalServer()
  console.log(`本地传输服务:${origin}`)

  const miniProgram = await openSession()
  try {
    await buildNpmInSession()
    if (npmBuild) {
      // npm 构建触发 DevTools 重编译:立即导航会与重编译竞速,
      // evaluate 通道在重编译窗口内会静默挂起(实测两轮复现)
      await new Promise((r) => setTimeout(r, 4000))
    }
    // 注意:automator 的 reLaunch/currentPage 在 Skyline 工程上不可靠
    // (reLaunch 谎报 ok 但页面栈不动,currentPage 取到旧页),
    // 改用 evaluate 注入 wx.navigateTo(实测可用)。
    const navToProbePage = () =>
      miniProgram.evaluate(
        (path) =>
          new Promise((resolve) => {
            const nav = () => {
              try {
                globalThis.wx.navigateTo({
                  url: path,
                  complete: (r) => resolve(r.errMsg?.includes('fail') ? r.errMsg : null),
                })
              } catch (err) {
                resolve(`navigateTo threw: ${err}`)
              }
            }
            // 常驻会话多轮复用:navigateTo 持续压栈(上限 10 层),
            // 先退回栈底再进页;reLaunch 在 Skyline 工程上谎报成功,不可用。
            // 退栈后必须等转场完成再进页(在 complete 里链式发起会因
            // 转场中的同步异常吞掉 resolve,导致 evaluate 永久 pending)。
            const depth = globalThis.getCurrentPages().length
            if (depth > 1) {
              globalThis.wx.navigateBack({ delta: depth - 1 })
              setTimeout(nav, 1200)
            } else {
              nav()
            }
          }),
        `/${pagePath}?origin=${encodeURIComponent(origin)}${demoPbBase ? `&pb=${encodeURIComponent(demoPbBase)}` : ''}`,
      )
    let navErr
    try {
      navErr = await navToProbePage()
    } catch {
      // 重编译余波:等一拍再试一次
      await new Promise((r) => setTimeout(r, 8000))
      navErr = await navToProbePage()
    }
    if (navErr) throw new Error(`探针页导航失败:${navErr}`)
    await new Promise((r) => setTimeout(r, 1500)) // 等探针页完成安装与自检

    // 探针页契约可能因「重编译 × 导航」竞速而未注册(页面崩在半编译状态):
    // 对未注册整轮重进页面(栈重置导航),最多 3 次;检查渐进追加(demo 组含
    // 网络往返),每轮轮询至条数稳定再判定。
    const readProbe = () =>
      miniProgram.evaluate(
        () => globalThis.__mpProbeRun?.() ?? { error: '探针页未注册 __mpProbeRun' },
      )
    let staticResult = { error: '尚未读取' }
    for (let attempt = 1; attempt <= 3; attempt++) {
      staticResult = await readProbe()
      for (let i = 0; i < 30 && Array.isArray(staticResult.checks); i++) {
        await new Promise((r) => setTimeout(r, 2000))
        const again = await readProbe()
        const prev = staticResult.checks.length
        staticResult = again
        if (Array.isArray(again.checks) && again.checks.length === prev) break
      }
      if (!staticResult.error) break
      console.log(`探针页契约未就绪(第 ${attempt} 次),重进页面…`)
      if (attempt < 3) {
        await navToProbePage().catch(() => null)
        await new Promise((r) => setTimeout(r, 3000))
      }
    }

    // 真实传输检查:在页面上下文用 wx 桥访问本机服务
    const liveResult = await miniProgram.evaluate(async (liveOrigin) => {
      const checks = []
      const push = (name, ok, detail) => checks.push({ name, ok, detail })

      try {
        const response = await fetch(`${liveOrigin}/json`)
        const data = await response.json()
        push('fetch-json-live', response.ok && data.ok === true, `status=${response.status}`)
      } catch (err) {
        push('fetch-json-live', false, String(err))
      }

      try {
        const response = await fetch(`${liveOrigin}/sse`, { mp: { enableChunked: true } })
        const reader = response.body.getReader()
        let text = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          text += new TextDecoder().decode(value, { stream: true })
        }
        push(
          'fetch-chunked-live',
          text.includes('data: 你好') && text.includes('data: sse'),
          text.slice(0, 80),
        )
      } catch (err) {
        push('fetch-chunked-live', false, String(err))
      }
      try {
        const response = await fetch(`${liveOrigin}/utf8-split`, { mp: { enableChunked: true } })
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let text = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          text += decoder.decode(value, { stream: true })
        }
        text += decoder.decode()
        push('fetch-utf8-reassembly-live', text === '小码', JSON.stringify(text))
      } catch (err) {
        push('fetch-utf8-reassembly-live', false, String(err))
      }

      try {
        // 该函数体在小程序页面上下文执行(EventSource 由探针页安装到 globalThis)
        const ES = globalThis.EventSource
        if (typeof ES !== 'function') throw new Error('EventSource 全局不可用(探针页未安装?)')
        const events = await new Promise((resolvePromise, rejectPromise) => {
          const collected = []
          const es = new ES(`${liveOrigin}/sse`, {
            mp: { timeout: 30000, reconnectionTime: 30000 },
          })
          const timer = setTimeout(() => {
            es.close()
            rejectPromise(new Error('EventSource 超时'))
          }, 10000)
          es.onmessage = (ev) => {
            collected.push(ev.data)
            if (collected.length >= 2) {
              clearTimeout(timer)
              es.close()
              resolvePromise(collected)
            }
          }
          es.onerror = () => {
            if (collected.length < 2) {
              clearTimeout(timer)
              rejectPromise(new Error('EventSource 连接失败'))
            }
          }
        })
        push('eventsource-live', events.join(',') === '你好,sse', events.join(','))
      } catch (err) {
        push('eventsource-live', false, String(err))
      }

      return { checks }
    }, origin)

    // 确定性罐头传输检查:evaluate 注入「函数体接管」式 wx.request mock,
    // 在官方逻辑层运行时里复放真 HTTP 无法稳定构造的时序
    // (字节级 chunk 截断 / mid-stream abort / 非 2xx 空 body / SSE 跨 chunk 断字)。
    // 语义与 automator mockWxMethod 的「返回值替换」不同:此处完全由罐头函数
    // 自行驱动 onHeadersReceived/onChunkReceived/success/fail 的次数与时序。
    const hijackResult = await miniProgram.evaluate(async () => {
      const checks = []
      const push = (name, ok, detail) => checks.push({ name, ok, detail })
      const u8 = (arr) => new Uint8Array(arr)
      const utf8 = (s) => {
        const out = []
        for (const ch of s) {
          const cp = ch.codePointAt(0)
          if (cp < 0x80) out.push(cp)
          else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63))
          else if (cp < 0x10000)
            out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
          else
            out.push(
              0xf0 | (cp >> 18),
              0x80 | ((cp >> 12) & 63),
              0x80 | ((cp >> 6) & 63),
              0x80 | (cp & 63),
            )
        }
        return out
      }
      /** 接管 wx.request;返回恢复函数。impl(options) 返回罐头 task。 */
      const hijack = (impl) => {
        const wxApi = globalThis.wx
        const orig = wxApi.request
        wxApi.request = impl
        return () => {
          wxApi.request = orig
        }
      }
      /** 造一个可订阅的罐头 task,事件由返回的 emit 驱动。 */
      const cannedTask = () => {
        const chunkCbs = []
        const headerCbs = []
        return {
          task: {
            onChunkReceived: (cb) => chunkCbs.push(cb),
            onHeadersReceived: (cb) => headerCbs.push(cb),
            abort: () => {},
          },
          header: (h) => headerCbs.forEach((cb) => cb(h)),
          chunk: (bytes) => chunkCbs.forEach((cb) => cb({ data: u8(bytes).buffer })),
        }
      }

      // 1) fetch 流式:『你好』按 2+3+1 字节截断成 3 个 chunk,验证重组
      {
        let restore
        try {
          const bytes = utf8('你好')
          restore = hijack((options) => {
            const c = cannedTask()
            setTimeout(
              () =>
                c.header({
                  statusCode: 200,
                  header: { 'content-type': 'text/plain; charset=utf-8' },
                }),
              30,
            )
            setTimeout(() => c.chunk(bytes.slice(0, 2)), 80)
            setTimeout(() => c.chunk(bytes.slice(2, 5)), 140)
            setTimeout(() => c.chunk(bytes.slice(5)), 200)
            setTimeout(
              () => options.success && options.success({ statusCode: 200, header: {}, data: null }),
              260,
            )
            return c.task
          })
          const response = await fetch('http://canned.local/utf8-split', {
            mp: { enableChunked: true },
          })
          const text = await response.text()
          push(
            'fetch-utf8-split-hijack',
            response.status === 200 && text === '你好',
            JSON.stringify(text),
          )
        } catch (err) {
          push('fetch-utf8-split-hijack', false, String(err))
        } finally {
          restore?.()
        }
      }

      // 2) fetch mid-stream abort:chunk 持续流动,读到第一块后 abort
      {
        let restore
        try {
          restore = hijack((options) => {
            const c = cannedTask()
            const timer = setInterval(() => c.chunk(utf8('a')), 60)
            c.task.abort = () => {
              clearInterval(timer)
              if (options.fail) options.fail({ errMsg: 'request:fail abort' })
            }
            setTimeout(
              () => c.header({ statusCode: 200, header: { 'content-type': 'text/plain' } }),
              20,
            )
            return c.task
          })
          const controller = new AbortController()
          const response = await fetch('http://canned.local/forever', {
            mp: { enableChunked: true },
            signal: controller.signal,
          })
          const reader = response.body.getReader()
          await reader.read()
          controller.abort()
          try {
            await reader.read()
            push('fetch-abort-midstream-hijack', false, 'abort 后 read 未拒绝')
          } catch (err) {
            push(
              'fetch-abort-midstream-hijack',
              err && err.name === 'AbortError',
              `name=${err && err.name}`,
            )
          }
        } catch (err) {
          push('fetch-abort-midstream-hijack', false, String(err))
        } finally {
          restore?.()
        }
      }

      // 3) fetch 非 2xx 空 body(真机 chunked 已知坑:非 2xx 可能拿不到 body)
      {
        let restore
        try {
          restore = hijack((options) => {
            const c = cannedTask()
            setTimeout(
              () => c.header({ statusCode: 500, header: { 'content-type': 'application/json' } }),
              25,
            )
            setTimeout(
              () => options.success && options.success({ statusCode: 500, header: {}, data: null }),
              60,
            )
            return c.task
          })
          const response = await fetch('http://canned.local/boom', { mp: { enableChunked: true } })
          const text = await response.text()
          push(
            'fetch-http-error-hijack',
            response.ok === false && response.status === 500 && text === '',
            `status=${response.status} text=${JSON.stringify(text)}`,
          )
        } catch (err) {
          push('fetch-http-error-hijack', false, String(err))
        } finally {
          restore?.()
        }
      }

      // 4) EventSource:SSE 字节流在『你』的多字节序列中间截断
      {
        let restore
        try {
          restore = hijack(() => {
            const c = cannedTask()
            setTimeout(
              () => c.header({ statusCode: 200, header: { 'content-type': 'text/event-stream' } }),
              25,
            )
            // 『你好』= e4 bd a0 | e5 a5 bd,两个多字节字符都跨 chunk 截断
            setTimeout(() => c.chunk(utf8('retry: 100\n\ndata: ').concat([0xe4])), 70)
            setTimeout(() => c.chunk([0xbd, 0xa0, 0xe5]), 130)
            setTimeout(() => c.chunk([0xa5, 0xbd].concat(utf8('\n\nid: 7\ndata: sse\n\n'))), 190)
            // 长连接不 success(保持打开),由消费者 close
            return c.task
          })
          const ES = globalThis.EventSource
          if (typeof ES !== 'function') throw new Error('EventSource 全局不可用(探针页未安装?)')
          const result = await new Promise((resolvePromise, rejectPromise) => {
            const collected = []
            const es = new ES('http://canned.local/sse')
            const timer = setTimeout(() => {
              es.close()
              rejectPromise(new Error('EventSource 罐头超时'))
            }, 5000)
            let lastEventId = ''
            es.onmessage = (ev) => {
              collected.push(ev.data)
              lastEventId = ev.lastEventId
              if (collected.length >= 2) {
                clearTimeout(timer)
                es.close()
                resolvePromise({ messages: collected, lastEventId })
              }
            }
            es.onerror = () => {
              if (collected.length < 2) {
                clearTimeout(timer)
                es.close()
                rejectPromise(new Error('EventSource onError(MIME 门控或连接失败)'))
              }
            }
          })
          push(
            'eventsource-split-hijack',
            result.messages.join(',') === '你好,sse' && result.lastEventId === '7',
            `messages=${result.messages.join(',')} lastEventId=${result.lastEventId}`,
          )
        } catch (err) {
          push('eventsource-split-hijack', false, String(err))
        } finally {
          restore?.()
        }
      }

      return { checks }
    })

    const report = {
      generatedAt: new Date().toISOString(),
      page: pagePath,
      origin,
      static: staticResult,
      live: liveResult,
      hijack: hijackResult,
    }
    writeFileSync(reportFile, JSON.stringify(report, null, 2))

    const all = [
      ...(staticResult.checks ?? []),
      ...(liveResult.checks ?? []),
      ...(hijackResult.checks ?? []),
    ]
    const failed = all.filter((c) => !c.ok)
    for (const check of all) {
      console.log(
        `${check.ok ? '✓' : '✗'} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`,
      )
    }
    console.log(`\n探针结果:${all.length - failed.length}/${all.length} 通过 → ${reportFile}`)
    process.exitCode = failed.length === 0 && !staticResult.error ? 0 : 1
  } finally {
    await teardown(miniProgram, server)
  }
}

/** 默认 disconnect(实例常驻,下次 connect 零弹窗);--close 才真正关掉。 */
async function teardown(mini, server) {
  if (closeAfterRun) await mini.close().catch(() => {})
  else mini.disconnect()
  server.close()
  server.closeAllConnections?.()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
