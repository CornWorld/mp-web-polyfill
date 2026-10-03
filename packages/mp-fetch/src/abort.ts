import { MPAbortError } from '@cornworld/mp-core'

export interface AbortSignalEventLike {
  type: string
  target: unknown
}

type Listener = (ev: AbortSignalEventLike) => void

const abortInternal = Symbol('cornworld.abortInternal')

/**
 * 小程序逻辑层没有 DOMException / EventTarget,
 * 这里提供与 DOM AbortSignal 兼容的最小实现。
 */
export class AbortSignal {
  #aborted = false
  #reason: unknown
  #listeners = new Map<string, Set<Listener>>()
  #onabort: Listener | null = null

  get aborted(): boolean {
    return this.#aborted
  }

  get reason(): unknown {
    return this.#reason
  }

  get onabort(): Listener | null {
    return this.#onabort
  }

  set onabort(cb: Listener | null) {
    this.#onabort = cb
  }

  static abort(reason?: unknown): AbortSignal {
    const controller = new AbortController()
    controller.abort(reason)
    return controller.signal
  }

  addEventListener(type: string, cb: Listener, options?: { once?: boolean }): void {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set())
    this.#listeners.get(type)!.add(cb)
    if (options?.once) {
      const wrapped = (ev: AbortSignalEventLike) => {
        this.removeEventListener(type, wrapped)
        cb(ev)
      }
      // 以 wrapped 替换注册,保证 once 语义
      this.#listeners.get(type)!.delete(cb)
      this.#listeners.get(type)!.add(wrapped)
    }
  }

  removeEventListener(type: string, cb: Listener): void {
    this.#listeners.get(type)?.delete(cb)
  }

  throwIfAborted(): void {
    if (this.#aborted) {
      throw this.#reason instanceof Error ? this.#reason : new MPAbortError()
    }
  }

  [abortInternal](reason?: unknown): void {
    if (this.#aborted) return
    this.#aborted = true
    this.#reason = reason ?? new MPAbortError()
    const ev: AbortSignalEventLike = { type: 'abort', target: this }
    for (const cb of this.#listeners.get('abort') ?? []) cb(ev)
    this.#onabort?.(ev)
  }
}

export class AbortController {
  #signal = new AbortSignal()

  get signal(): AbortSignal {
    return this.#signal
  }

  abort(reason?: unknown): void {
    this.#signal[abortInternal](reason)
  }
}
