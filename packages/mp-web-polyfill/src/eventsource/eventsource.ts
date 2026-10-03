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
    /** 长连接超时(毫秒);真机默认 60s 会被掐断,建议显式调大 */
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
 * WHATWG EventSource 客户端:
 * 传输层 = wx.request enableChunked(onChunkReceived → UTF-8 增量解码);
 * 解析层 = eventsource-parser(规范实现);
 * 状态机 = 重连(retry/Last-Event-ID)、MIME 门控、readyState、事件分发。
 * 与规范偏差:无 CORS/凭据语义(小程序无 CORS),重连遵循 retry 且不设次数上限。
 */
export class EventSource {
  static readonly CONNECTING = CONNECTING
  static readonly OPEN = OPEN
  static readonly CLOSED = CLOSED

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
      this.#dispatchError()
      return
    }

    const headers: Record<string, string> = {
      accept: 'text/event-stream',
      'cache-control': 'no-cache',
    }
    if (this.#lastEventId !== '') headers['last-event-id'] = this.#lastEventId

    let opened = false
    let headersOk = false

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
      const contentType = (r.header['content-type'] ?? '').split(';')[0]?.trim().toLowerCase()
      if (r.statusCode !== 200 || contentType !== 'text/event-stream') {
        headersOk = true
        this.#task?.abort()
        this.#dispatchError()
        this.#scheduleReconnect()
        return
      }
      headersOk = true
      if (!opened) {
        opened = true
        this.#readyState = OPEN
        this.#onopen?.()
        for (const cb of this.#listeners.get('open') ?? []) (cb as () => void)()
      }
    })

    this.#task.onChunkReceived?.((r) => {
      if (this.#closed) return
      this.#parser.feed(this.#decoder.decode(new Uint8Array(r.data), { stream: true }))
    })
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
    this.#onerror?.()
    for (const cb of this.#listeners.get('error') ?? []) (cb as () => void)()
  }

  #handleDisconnect(): void {
    if (this.#closed) return
    this.#dispatchError()
    this.#readyState = CONNECTING
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
