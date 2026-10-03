import { concatBytes, toArrayBuffer, toUint8Array } from '@cornworld/mp-core'
import { TextDecoder } from '@cornworld/mp-text-encoding'
import { Blob } from './form-data'
import type { PushStreamHandle } from './streams'

/**
 * Request / Response 共享的 Body mixin:
 * 缓冲字节或推送式流,body 只能消费一次(bodyUsed 语义与规范一致)。
 */
export abstract class BodyBase {
  #bytes: Uint8Array | null
  #stream: PushStreamHandle | null
  #contentType: string | undefined
  #bodyUsed = false

  constructor(params: {
    bytes?: Uint8Array | null
    stream?: PushStreamHandle | null
    contentType?: string | undefined
  }) {
    this.#bytes = params.bytes ?? null
    this.#stream = params.stream ?? null
    this.#contentType = params.contentType
  }

  get bodyUsed(): boolean {
    return this.#bodyUsed
  }

  /**
   * 流式响应返回 ReadableStream;缓冲模式返回 null
   * (与规范的偏差:缓冲 body 不再包一层流,text/arrayBuffer 仍可消费)。
   */
  get body(): unknown {
    return this.#stream?.stream ?? null
  }

  /** 内部访问口:序列化请求体用,非公共 API。 */
  get _bodyBytes(): Uint8Array | null {
    return this.#bytes
  }

  get _contentType(): string | undefined {
    return this.#contentType
  }

  _attachStream(handle: PushStreamHandle): void {
    this.#stream = handle
  }

  async #consume(): Promise<Uint8Array> {
    if (this.#bodyUsed) throw new TypeError('Body has already been consumed.')
    this.#bodyUsed = true
    if (this.#stream) {
      const reader = (
        this.#stream.stream as {
          getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> }
        }
      ).getReader()
      const chunks: Uint8Array[] = []
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) chunks.push(toUint8Array(value))
      }
      return concatBytes(chunks)
    }
    return this.#bytes ?? new Uint8Array(0)
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.#consume().then((bytes) => toArrayBuffer(bytes))
  }

  text(): Promise<string> {
    return this.#consume().then((bytes) => new TextDecoder().decode(bytes))
  }

  json(): Promise<unknown> {
    return this.text().then((text) => JSON.parse(text) as unknown)
  }

  blob(): Promise<Blob> {
    return this.#consume().then((bytes) => new Blob([bytes], { type: this.#contentType ?? '' }))
  }
}
