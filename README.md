# mp-web-polyfill

微信小程序逻辑层 Web API polyfill 家族:`fetch` / `EventSource` / `URL` / `TextEncoder` / `localStorage` / `FormData`。

- 提供组装层 + 冲突管理, 拒绝从零造轮子
- Skyline / WebView 双引擎通用
- 解决小程序逻辑层无 Web 全局对象, Web 生态库(PocketBase JS SDK 等) 无法直接运行 的问题

## 子 NPM 包列表

| 路径 | 覆盖 | 依赖引擎 | wx 桥(手写) |
|---|---|---|---|
| `/core` | 运行时检测、AbortError、字节工具 | — | `WxLike` 最小接口(全家族唯一 seam) |
| `/text-encoding` | `TextEncoder` / `TextDecoder`(UTF-8,流式) | — | WHATWG utf-8 编解码状态机 |
| `/url` | `URL` / `URLSearchParams` / `canParse` / `parse` | whatwg-url 状态机(vendor 于 `src/url/engine/`) | 薄包装 + `canParse` / `parse` 增补 |
| `/url/idna` | 完整 IDNA(UTS46 / tr46 数据表,约 213KB) | tr46 | — |
| `/fetch` | `fetch` / `Request` / `Response` / `Headers` / `AbortController` / `Blob` / `File` / `FormData` | 内置最小 ReadableStream(约 2KB) | `wx.request` 传输桥、multipart 序列化、abort |
| `/fetch/abort` `/fetch/form-data` `/fetch/streams` | 上述能力的细分子路径,按需拆分引入 | 同上 | — |
| `/streams/full` | 完整 WHATWG Streams(tee / pipeTo / 背压) | web-streams-polyfill(约 62KB) | — |
| `/eventsource` | `EventSource`(SSE) | eventsource-parser | `wx.request enableChunked` 传输、重连状态机 |
| `/storage` | `localStorage` | — | `wx.setStorageSync` 桥、配额错误映射 |
| `/installer` | 一站式 API 级安装器 | web-streams-polyfill | 冲突检测 / 标记 / 诊断 |

- `@cornworld/wx-mock`(internal):测试专用模拟宿主,不发布
- 产物形态:tsup 单聚合入口,每格式一个 bundle,所有子路径指向同一份产物。跨入口 `instanceof` 与单例一致性由产物结构保证

## 安装

```bash
pnpm add mp-web-polyfill
```

## 使用

默认使用裁剪版(lite), 域名引擎仅 ASCII (小程序合法域名要求 ICP 备案 ASCII 域名), 流式用内置最小 ReadableStream。
满血版本/较重依赖通过独立子路径按需引入, 不默认加载。

```ts
import { fetch, URL } from 'mp-web-polyfill/fetch'
import { localStorage } from 'mp-web-polyfill/storage'
import { EventSource } from 'mp-web-polyfill/eventsource'

import 'mp-web-polyfill/url/idna'      // 非 ASCII 域名 → punycode,独立 bundle,幂等
import 'mp-web-polyfill/streams/full'  // 完整 Streams,独立 bundle,幂等
```

### 安装器

```ts
import { installWebRuntimeGlobals, listGlobalsStatus } from 'mp-web-polyfill/installer'

installWebRuntimeGlobals()                                  // 全量
installWebRuntimeGlobals({ targets: ['fetch'] })            // API 级粒度
installWebRuntimeGlobals({ targets: ['URL'], force: true }) // 显式接管
listGlobalsStatus() // [{ name, source: 'ours' | 'host' | 'absent' }]
```

冲突规则:

1. 宿主原生或第三方已有实现,默认跳过
2. `force: true` 显式接管,上报 `replaced`
3. 本家族重复安装幂等
4. 已装实现打 `Symbol.for('cornworld.mp-polyfill')` 标记,可诊断来源

### 作用域须知(DevTools 实测)

页面模块运行在 `with(白名单代理)` 受限作用域,运行期装入 `globalThis` 的属性对裸标识符不可见:

| 裸标识符 | 可用性 |
|---|---|
| `fetch` / `EventSource` / `URL` | 不可用 |
| `AbortController` / `TextDecoder` / `FormData` / `File` / `Blob` | 可用(V8 内建白名单) |
| `globalThis.x` 显式访问 | 始终可靠 |

页面代码一律 `globalThis.x` 或模块 import。探针页 `bare-fetch-visible` 为该语义的常驻检查。

## 真机差异

| 差异 | 处理 |
|---|---|
| `wx.request` 默认 timeout 60s | SSE / 长连接显式调大 |
| 切后台 5s 内未完成请求被 kill | `App.onShow` 重连重订阅 |
| `enableChunked` 走 HTTP/1.1,与高性能模式互斥 | chunked 模式下非 2xx 可能拿不到 body |
| `onChunkReceived` 给 `ArrayBuffer`,跨 chunk 截断 UTF-8 多字节 | `TextDecoder({ stream: true })` 增量解码 |
| `wx.request` 并发上限 10 | EventSource 单连接复用全部订阅 |
| 域名白名单 | HTTPS + 有效证书 + ICP 备案 |

体积:全量 installer bundle 351KB → 49KB min(92KB → 15KB gzip)。tr46 数据表与 web-streams-polyfill 已移出默认模块图。

## 开发

```bash
pnpm test        # A 规约逻辑(零 mock)+ B 传输桥(wx-mock)
pnpm build       # tsup esm/cjs + 子路径 d.ts
pnpm typecheck   # tsc -b(project references)
pnpm lint
pnpm sync:wpt    # WPT urltestdata.json 语料(钉 commit)
pnpm pack:all
```

- 测试分层:A 规约逻辑(Node 零 mock)、B 传输桥协议(`@cornworld/wx-mock`)、C 真机探针(`tools/probe/`,DevTools / 真机,nightly,不进 PR CI)
- 引擎测试深度:T1 冒烟(web-streams)→ T2 契约面(eventsource-parser,WPT 移植)→ T3 全量一致性(whatwg-url,WPT 483 例 + 已知偏差门)→ T4 自研全测
- 已知偏差基线:`packages/mp-web-polyfill/test/url/fixtures/wpt-known-failures.json`。刷新:`UPDATE_URL_BASELINE=1 pnpm vitest run packages/mp-web-polyfill/test/url/wpt-corpus.test.ts`
- 探针:`node tools/probe/run.mjs --project <工程> --page pages/probe/probe`。检查体契约 `__mpProbeRun`,真机独有语义以 hijack 罐头时序接入
- 非目标:CORS / 凭据 / 手动重定向语义(小程序无 CORS,wx 自动跟随重定向)

## 发布

- changesets:PR 带 `.changeset/*.md`,合入 main 后 bot 开版本 PR,合并即发布
- npm provenance(OIDC),Secret 配 `NPM_TOKEN`
- tarballs 归档于 GitHub Actions artifacts

## License

LGPL-3.0-only。全文见 [LICENSE](./LICENSE)。
