import { createParser, type EventSourceMessage } from 'eventsource-parser'
import { getWx, type WxRequestTask } from '../core'
import { TextDecoder } from '../text-encoding'
import { URL as MPURL } from '../url'

export { createParser }
export type { EventSourceMessage }

export interface MessageEventLike {
  type: string
  data: string
  lastEventId: string
  origin: string
}

export interface EventSourceOptions {
  withCredentials?: boolean
  /** 小程序特有扩展 */
  mp?: {
    /** 长连接超时(毫秒), 真机默认 60s 会被掐断, 建议显式调大 */
    timeout?: number
    /** 初始重连间隔(毫秒),可被服务端 retry 字段覆盖 */
    reconnectionTime?: number
  }
}

type MessageListener = (ev: MessageEventLike) => void

const CONNECTING = 0
const OPEN = 1
const CLOSED = 2

/**
 * wx.request onHeadersReceived 返回的 header 键保留服务端原始大小写
 * (真机实测 `Content-Type`,DevTools 部分版本小写),取值必须大小写不敏感。
 */
function getHeader(headers: Record<string, string>, name: string): string {
  const target = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key] ?? ''
  }
  return ''
}

/**
 * WHATWG EventSource 客户端。
 * 传输层用 wx.request enableChunked(onChunkReceived → UTF-8 增量解码),
 * 解析层用 eventsource-parser(规范实现),
 * 状态机负责重连(retry/Last-Event-ID)、MIME 门控、readyState 与事件分发。
 * 与规范偏差: 无 CORS/凭据语义(小程序无 CORS), 重连遵循 retry 且不设次数上限。
 */
export class EventSource {
  // 静态常量用 getter 而非静态字段:vite(esbuild) target < es2022 时静态字段会被
  // 展开成模块顶层的属性赋值语句(不纯),把整个类连同其引用链
  // (URL/whatwg-url/eventsource-parser)钉死在每个消费方 bundle 里,
  // 摇树失效(2026-10-04 探针实测)。getter 留在类体内可随类摇掉。
  static get CONNECTING(): number {
    return CONNECTING
  }
  static get OPEN(): number {
    return OPEN
  }
  static get CLOSED(): number {
    return CLOSED
  }

  readonly CONNECTING = CONNECTING
  readonly OPEN = OPEN
  readonly CLOSED = CLOSED

  #url: MPURL
  #withCredentials: boolean
  #mp: EventSourceOptions['mp']
  #readyState = CONNECTING
  #onopen: (() => void) | null = null
  #onmessage: MessageListener | null = null
  #onerror: (() => void) | null = null
  #listeners = new Map<string, Set<MessageListener | (() => void)>>()
  #retryMs: number
  #lastEventId = ''
  #parser: ReturnType<typeof createParser>
  #decoder = new TextDecoder()
  #task?: WxRequestTask
  #reconnectTimer?: ReturnType<typeof setTimeout>
  #closed = false

  constructor(url: string | MPURL, options: EventSourceOptions = {}) {
    const parsed = new MPURL(String(url))
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new SyntaxError(`EventSource: 仅支持 http/https,收到 ${parsed.href}`)
    }
    this.#url = parsed
    this.#withCredentials = options.withCredentials === true
    this.#mp = options.mp
    this.#retryMs = options.mp?.reconnectionTime ?? 3000
    this.#parser = createParser({
      onEvent: (msg) => this.#dispatchMessage(msg),
      onId: (id) => {
        this.#lastEventId = id
      },
      onRetry: (ms) => {
        this.#retryMs = ms
      },
      onError: () => {
        // 解析器级错误按规范静默(浏览器同样忽略)
      },
    })
    this.#connect()
  }

  get url(): string {
    return this.#url.href
  }

  get readyState(): number {
    return this.#readyState
  }

  get withCredentials(): boolean {
    return this.#withCredentials
  }

  get onopen(): (() => void) | null {
    return this.#onopen
  }

  set onopen(cb: (() => void) | null) {
    this.#onopen = cb
  }

  get onmessage(): MessageListener | null {
    return this.#onmessage
  }

  set onmessage(cb: MessageListener | null) {
    this.#onmessage = cb
  }

  get onerror(): (() => void) | null {
    return this.#onerror
  }

  set onerror(cb: (() => void) | null) {
    this.#onerror = cb
  }

  addEventListener(type: string, cb: MessageListener | (() => void)): void {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set())
    this.#listeners.get(type)!.add(cb)
  }

  removeEventListener(type: string, cb: MessageListener | (() => void)): void {
    this.#listeners.get(type)?.delete(cb)
  }

  close(): void {
    this.#closed = true
    this.#readyState = CLOSED
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
    this.#task?.abort()
  }

  #connect(): void {
    if (this.#closed) return
    this.#readyState = CONNECTING
    const wx = getWx()
    if (!wx) {
      // 无宿主则永远无法建立连接:按 fail the connection 终态处理,避免悬挂在 CONNECTING
      this.#failConnection()
      return
    }

    const headers: Record<string, string> = {
      accept: 'text/event-stream',
      'cache-control': 'no-cache',
    }
    if (this.#lastEventId !== '') headers['last-event-id'] = this.#lastEventId

    let headersOk = false
    // onHeadersReceived 与 onChunkReceived 的到达顺序真机无契约:
    // header 处理完之前的 chunk 先入队,门控通过后按序回放
    const pendingChunks: ArrayBuffer[] = []

    this.#task = wx.request({
      url: this.#url.href,
      method: 'GET',
      header: headers,
      enableChunked: true,
      responseType: 'arraybuffer',
      // 长连接:显式调大,避免默认 60s 被 wx 掐断
      timeout: this.#mp?.timeout ?? 10 * 60 * 1000,
      success: () => {
        // 服务端结束流 → 规范语义为“连接失败”,触发 error + 重连
        this.#handleDisconnect()
      },
      fail: () => {
        this.#handleDisconnect()
      },
    })

    this.#task.onHeadersReceived?.((r) => {
      if (this.#closed || headersOk) return
      headersOk = true
      // 规范(Fetch get a header + mimesniff): 取 Content-Type 按
      // 大小写不敏感, 多值(逗号合并)任一 essence 匹配即通过,
      // essence = 剥参数 + trim + ASCII 小写, 参数(如 charset)忽略
      const essenceList = getHeader(r.header, 'content-type')
        .split(',')
        .map((value) => value.split(';')[0]?.trim().toLowerCase())
      if (r.statusCode !== 200 || !essenceList.includes('text/event-stream')) {
        // 规范:非 200 或 MIME 不符 → fail the connection(CLOSED + error,不重连)
        this.#failConnection()
        return
      }
      if (this.#readyState !== OPEN) {
        this.#readyState = OPEN
        this.#onopen?.()
        for (const cb of this.#listeners.get('open') ?? []) (cb as () => void)()
      }
      for (const chunk of pendingChunks.splice(0)) this.#feedChunk(chunk)
    })

    this.#task.onChunkReceived?.((r) => {
      if (this.#closed) return
      if (!headersOk) {
        pendingChunks.push(r.data)
        return
      }
      this.#feedChunk(r.data)
    })
  }

  #feedChunk(data: ArrayBuffer): void {
    this.#parser.feed(this.#decoder.decode(new Uint8Array(data), { stream: true }))
  }

  #dispatchMessage(msg: EventSourceMessage): void {
    if (this.#closed) return
    // 规范:空 data 缓冲不派发(eventsource-parser 会派发 data:'',此处对齐规范)
    if (msg.data === '') return
    const type = msg.event || 'message'
    const event: MessageEventLike = {
      type,
      data: msg.data,
      lastEventId: msg.id ?? '',
      origin: this.#url.origin,
    }
    if (type === 'message') this.#onmessage?.(event)
    for (const cb of this.#listeners.get(type) ?? []) {
      ;(cb as MessageListener)(event)
    }
  }

  #dispatchError(): void {
    if (this.#closed) return
    this.#emitError()
  }

  #emitError(): void {
    this.#onerror?.()
    for (const cb of this.#listeners.get('error') ?? []) (cb as () => void)()
  }

  /**
   * 规范 fail the connection:readyState → CLOSED、fire error、不再重连。
   * 用于永久性失败(MIME 门控 / 非 200 / 无宿主),与网络错误的
   * #handleDisconnect(error + 重连)相对。#closed 先置位,#task.abort()
   * 触发的 fail 回调会被各入口短路,保证 error 恰好派发一次。
   */
  #failConnection(): void {
    if (this.#closed) return
    this.#closed = true
    this.#readyState = CLOSED
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
    this.#task?.abort()
    this.#emitError()
  }

  #handleDisconnect(): void {
    if (this.#closed) return
    // 规范 reestablish the connection:先置 CONNECTING,再 fire error
    this.#readyState = CONNECTING
    this.#dispatchError()
    this.#scheduleReconnect()
  }

  #scheduleReconnect(): void {
    if (this.#closed) return
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
    this.#reconnectTimer = setTimeout(() => {
      this.#parser.reset()
      this.#decoder = new TextDecoder()
      this.#connect()
    }, this.#retryMs)
  }
}
