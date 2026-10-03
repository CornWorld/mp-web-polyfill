import { toUint8Array } from '../core'

interface DecodeOptions {
  stream?: boolean
}

interface TextDecoderOptions {
  fatal?: boolean
  ignoreBOM?: boolean
}

/**
 * WHATWG Encoding 规范的 UTF-8 解码器(增量状态机)。
 * 与平台原生实现一致:fatal 时对非法字节抛 TypeError,
 * 非 fatal 时按“最长合法子串”规则替换为 U+FFFD;默认剥离开头 BOM。
 */
export class TextDecoder {
  readonly encoding = 'utf-8'

  #fatal: boolean
  #ignoreBOM: boolean
  #bomChecked = false
  #bytesNeeded = 0
  #codePoint = 0
  #bytesSeen = 0
  #lowerBoundary = 0x80
  #upperBoundary = 0xbf

  constructor(label = 'utf-8', options: TextDecoderOptions = {}) {
    const normalized = String(label).trim().toLowerCase()
    if (normalized !== 'utf-8' && normalized !== 'utf8') {
      throw new RangeError(`The encoding label provided ('${label}') is invalid.`)
    }
    this.#fatal = options.fatal === true
    this.#ignoreBOM = options.ignoreBOM === true
  }

  get fatal(): boolean {
    return this.#fatal
  }

  get ignoreBOM(): boolean {
    return this.#ignoreBOM
  }

  decode(input?: ArrayBuffer | ArrayBufferView, options: DecodeOptions = {}): string {
    const bytes = input ? toUint8Array(input) : new Uint8Array(0)
    let out = ''
    let i = 0

    while (i < bytes.length) {
      const b: number = bytes[i]!
      let emitted: number | null = null
      let reprocess = false

      if (this.#bytesNeeded === 0) {
        if (b <= 0x7f) {
          emitted = b
        } else if (b >= 0xc2 && b <= 0xdf) {
          this.#startSequence(1, 0x80, 0xbf, b & 0x1f)
        } else if (b === 0xe0) {
          this.#startSequence(2, 0xa0, 0xbf, b & 0x0f)
        } else if ((b >= 0xe1 && b <= 0xec) || (b >= 0xee && b <= 0xef)) {
          this.#startSequence(2, 0x80, 0xbf, b & 0x0f)
        } else if (b === 0xed) {
          this.#startSequence(2, 0x80, 0x9f, b & 0x0f)
        } else if (b === 0xf0) {
          this.#startSequence(3, 0x90, 0xbf, b & 0x07)
        } else if (b >= 0xf1 && b <= 0xf3) {
          this.#startSequence(3, 0x80, 0xbf, b & 0x07)
        } else if (b === 0xf4) {
          this.#startSequence(3, 0x80, 0x8f, b & 0x07)
        } else {
          this.#onInvalid()
          emitted = 0xfffd
        }
      } else if (b < this.#lowerBoundary || b > this.#upperBoundary) {
        this.#reset()
        this.#onInvalid()
        emitted = 0xfffd
        reprocess = true
      } else {
        this.#lowerBoundary = 0x80
        this.#upperBoundary = 0xbf
        this.#codePoint = (this.#codePoint << 6) | (b & 0x3f)
        this.#bytesSeen += 1
        if (this.#bytesSeen === this.#bytesNeeded) {
          emitted = this.#codePoint
          this.#reset()
        }
      }

      if (emitted !== null) out += String.fromCodePoint(emitted)
      if (reprocess) continue
      i += 1
    }

    if (!options.stream && this.#bytesNeeded > 0) {
      // 流截断:结尾缺续字节
      this.#reset()
      this.#onInvalid()
      out += String.fromCodePoint(0xfffd)
    }

    if (!this.#bomChecked && out.length > 0) {
      this.#bomChecked = true
      if (!this.#ignoreBOM && out.charCodeAt(0) === 0xfeff) out = out.slice(1)
    }
    return out
  }

  #startSequence(needed: number, lower: number, upper: number, cp: number): void {
    this.#bytesNeeded = needed
    this.#lowerBoundary = lower
    this.#upperBoundary = upper
    this.#codePoint = cp
    // bytesNeeded 计的是“还差几个续字节”,首字节不算
    this.#bytesSeen = 0
  }

  #reset(): void {
    this.#bytesNeeded = 0
    this.#bytesSeen = 0
    this.#lowerBoundary = 0x80
    this.#upperBoundary = 0xbf
  }

  #onInvalid(): void {
    if (this.#fatal) {
      this.#reset()
      throw new TypeError('The encoded data is not valid.')
    }
  }
}
