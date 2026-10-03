#!/usr/bin/env node
/**
 * 业务打桩 mock 桥(C 层工具,官方 automator 驱动,与 minium 同一 DevTools 协议)。
 *
 * 用途:UI 开发/测试时在自动化会话内按 URL 拦截 wx.request,返回罐头数据;
 * 未命中的请求经 this.origin 放行(真实网络)。
 *
 * 能力边界(automator 0.12.1 + DevTools 2.06 实测结论):
 * - ✅ 按 URL 路由罐头 success/fail(automator.mockWxMethod;minium 的 mock_wx_method 同为结果替换,官方文档无函数体形式)
 * - ✅ 函数形式动态路由(fn 序列化进 AppService,无闭包;this.origin 可调原始方法)
 * - ✅ 放行未命中请求(this.origin 真发请求,但结果须 Promise 代理,见下方语义)
 * - ✅ --delay 延迟罐头(mock 返回值支持 Promise)
 * - ❌ 流式/enableChunked 多次 onChunkReceived(罐头无流;真流式用真 PB 或 wx-mock)
 * - ❌ 无 DevTools 的 CI(需登录态;CI 用 @cornworld/wx-mock)
 *
 * 用法:先手开微信开发者工具(登录态)并开启服务端口,然后:
 *   node tools/mock/automator-mock.mjs --project <小程序工程> \
 *     --routes <routes.json> [--cli <devtools cli>] [--port 9420] [--delay 300]
 *
 * mock 函数调用语义(DevTools 内置 App.mockWxMethod 实测,2026-10-03):
 *   fn.apply({ origin }, [options, ...mockWxMethod 尾参])
 *   结果通路是「返回值替换」(minium 的 mock_wx_method 官方文档同为结果替换;真函数体接管走 evaluate 注入,见 tools/probe 的 hijack 检查):
 *   - 返回 {statusCode,data,header} → 调用方 success(该对象)
 *   - 返回 {errMsg} → 调用方 fail(该对象)
 *   - 返回 Promise → resolve 值按上述规则(延迟罐头靠这个)
 *   - 返回 undefined → 调用方回调永不触发(死等,禁止)
 *   - this.origin(options) 真发请求,但其结果不会自动回到调用方:
 *     放行必须 new Promise(...) 包 origin,把真实 success/fail resolve 回去
 *   因此 fn 必须是函数本体(自由变量序列化后在 AppService 不存在),签名为
 *   (options, routes, delay),不能用闭包工厂的返回值。
 *
 * routes.json 形如:
 * {
 *   "match": [
 *     { "urlPrefix": "http://127.0.0.1:8090/api/collections/notes/records",
 *       "statusCode": 200,
 *       "body": { "page": 1, "perPage": 20, "totalItems": 0, "items": [] } },
 *     { "urlRegExp": "auth-with-password$",
 *       "statusCode": 200,
 *       "body": { "token": "<jwt>", "record": { "id": "u1", "collectionName": "users" } } },
 *     { "urlRegExp": "explode$", "fail": true, "errMsg": "request:fail canned" }
 *   ]
 * }
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import automator from 'miniprogram-automator'

export { requestInterceptor }

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1]
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.project || !args.routes) {
    console.error(
      '用法:--project <小程序工程路径> --routes <routes.json> [--cli <cli>] [--port 9420] [--delay 300]',
    )
    process.exit(1)
  }
  const routes = JSON.parse(readFileSync(args.routes, 'utf8')).match ?? []
  const cliPath = args.cli ?? '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'

  const miniProgram = await automator
    .connect({ wsEndpoint: `ws://localhost:${args.port ?? 9420}` })
    .catch(async () => await automator.launch({ cliPath, projectPath: args.project }))
  if (!miniProgram) {
    console.error('无法连接/拉起开发者工具自动化会话(检查登录态与服务端口)')
    process.exit(1)
  }

  await miniProgram.mockWxMethod('request', requestInterceptor, routes, Number(args.delay ?? 0))
  console.log(`mock 已挂载:${routes.length} 条路由;Ctrl+C 退出并自动 restore`)
  process.on('SIGINT', async () => {
    await miniProgram.restoreWxMethod('request').catch(() => {})
    await miniProgram.disconnect().catch(() => {})
    process.exit(0)
  })
}

// 直接以 CLI 运行时才连接 DevTools;被测试 import 时不产生副作用
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}

/**
 * 序列化进 AppService 的拦截函数(不能用闭包):routes/delay 由 mockWxMethod
 * 尾参注入(见文件头调用语义)。命中 → 返回罐头对象/延迟 Promise;未命中 →
 * Promise 代理 this.origin 的真实结果(DevTools 内置 mock 不回传 origin 回调)。
 */
function requestInterceptor(options, routes, delay) {
  const hit = routes.find((route) => {
    if (route.urlPrefix && options.url?.startsWith(route.urlPrefix)) return true
    if (route.urlRegExp) {
      try {
        return new RegExp(route.urlRegExp).test(options.url ?? '')
      } catch {
        return false
      }
    }
    return false
  })

  if (!hit) {
    return new Promise((resolve) => {
      const passthrough = { ...options }
      passthrough.success = (res) => resolve(res)
      passthrough.fail = (err) => resolve(err)
      this.origin(passthrough)
    })
  }

  const canned = () =>
    hit.fail
      ? { errMsg: hit.errMsg ?? 'request:fail canned' }
      : {
          statusCode: hit.statusCode ?? 200,
          data: JSON.stringify(hit.body ?? {}),
          header: hit.header ?? { 'content-type': 'application/json' },
        }

  if (delay > 0) return new Promise((resolve) => setTimeout(() => resolve(canned()), delay))
  return canned()
}
