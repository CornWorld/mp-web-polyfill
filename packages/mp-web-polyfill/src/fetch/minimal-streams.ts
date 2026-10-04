/**
 * 最小 ReadableStream:只覆盖本家族的流式消费面 ——
 * 生产端:new RS({ start(c) }) + c.enqueue/close/error(fetch 桥的推送式流);
 * 消费端:getReader().read()(body.text()/json()/手动读循环)。
 *
 * 相对 WHATWG Streams 规范的裁剪(显式声明,不做半吊子):
 * - 无 tee / pipeTo / pipeThrough / BYOB / desiredSize 背压(enqueue 永不阻塞,
 *   与 wx.onChunkReceived 的拉流节奏匹配);不支持 pull 调度与 queuing strategy;
 * - cancel 只关闭流;releaseLock 后挂起的 read 随流落定,不会提前 reject;
 * - enqueue/close 在非 open 状态静默忽略(规范要求抛错 —— 这里是为
 *   wx 回调竞态故意放宽:迟到的 onChunkReceived 不允许炸掉消费方)。
 * 需要完整 Streams 规范时:宿主原生(优先)或 import 'mp-web-polyfill/streams/full'
 * (web-streams-polyfill,独立 bundle,按需携带 ~62KB)。
 */

export interface MinimalReadableStreamController {
  enqueue(chunk: Uint8Array): void
  close(): void
  error(err: unknown): void
}

export interface MinimalReadableStreamSource {
  start(controller: MinimalReadableStreamController): void
}

export interface MinimalReadResult {
  done: boolean
  value?: Uint8Array
}

type PendingRead = {
  resolve: (result: MinimalReadResult) => void
  reject: (err: unknown) => void
}

export class MinimalReadableStream {
  #queue: Uint8Array[] = []
  #pending: PendingRead[] = []
  #state: 'open' | 'closed' | 'errored' = 'open'
  #storedError: unknown
  #reader: MinimalReadableStreamDefaultReader | null = null

  constructor(source: MinimalReadableStreamSource) {
    // start 抛错与原生一致:同步冒出构造函数(差分审计 2026-10-04 实测)
    source.start({
      enqueue: (chunk) => this.#enqueue(chunk),
      close: () => this.#closeInternal(),
      error: (err) => this.#error(err),
    })
  }

  #enqueue(chunk: Uint8Array): void {
    if (this.#state !== 'open') return
    const pending = this.#pending.shift()
    if (pending) pending.resolve({ done: false, value: chunk })
    else this.#queue.push(chunk)
  }

  #closeInternal(): void {
    if (this.#state !== 'open') return
    this.#state = 'closed'
    for (const pending of this.#pending.splice(0)) pending.resolve({ done: true })
  }

  #error(err: unknown): void {
    if (this.#state !== 'open') return
    this.#state = 'errored'
    this.#storedError = err
    for (const pending of this.#pending.splice(0)) pending.reject(err)
  }

  get locked(): boolean {
    return this.#reader !== null
  }

  getReader(): MinimalReadableStreamDefaultReader {
    if (this.#reader !== null) throw new TypeError('ReadableStream is locked')
    const reader = new MinimalReadableStreamDefaultReader(this)
    this.#reader = reader
    return reader
  }

  /** 规范 cancel 的最小语义:关闭流,排空挂起读(数据不保证送达)。 */
  _cancel(): void {
    this.#closeInternal()
  }

  _readerReleased(reader: MinimalReadableStreamDefaultReader): void {
    if (this.#reader === reader) this.#reader = null
  }

  // 以下由 reader 内部调用(模块内 seam,不进公共 API)

  _read(): Promise<MinimalReadResult> {
    if (this.#state === 'errored') return Promise.reject(this.#storedError)
    const chunk = this.#queue.shift()
    if (chunk) return Promise.resolve({ done: false, value: chunk })
    if (this.#state === 'closed') return Promise.resolve({ done: true })
    return new Promise((resolve, reject) => {
      this.#pending.push({ resolve, reject })
    })
  }
}

export class MinimalReadableStreamDefaultReader {
  #stream: MinimalReadableStream
  #released = false

  constructor(stream: MinimalReadableStream) {
    this.#stream = stream
  }

  get locked(): boolean {
    return !this.#released
  }

  read(): Promise<MinimalReadResult> {
    if (this.#released) return Promise.reject(new TypeError('Reader is released'))
    return this.#stream._read()
  }

  releaseLock(): void {
    if (this.#released) return
    this.#released = true
    this.#stream._readerReleased(this)
  }

  cancel(): Promise<void> {
    // 与原生一致:cancel 不释放锁,reader 仍可继续 read(落定 done)
    this.#stream._cancel()
    return Promise.resolve()
  }
}
