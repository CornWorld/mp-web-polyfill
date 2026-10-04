import { concatBytes, toArrayBuffer } from '../core'
import { TextDecoder, TextEncoder } from '../text-encoding'

export type BlobPart = string | ArrayBuffer | ArrayBufferView | Blob

const encoder = new TextEncoder()

export interface BlobOptions {
  type?: string
}

/**
 * 内存版 Blob(小程序无二进制宿主对象)。
 * 只支持内存字节, 真实文件上传应走 wx.uploadFile 适配层。
 */
export class Blob {
  #bytes: Uint8Array
  readonly type: string

  constructor(parts: BlobPart[] = [], options: BlobOptions = {}) {
    const chunks: Uint8Array[] = []
    for (const part of parts) {
      if (typeof part === 'string') chunks.push(encoder.encode(part))
      else if (part instanceof Blob) chunks.push(part._bytes)
      else if (part instanceof ArrayBuffer) chunks.push(new Uint8Array(part))
      else if (ArrayBuffer.isView(part))
        chunks.push(new Uint8Array(part.buffer, part.byteOffset, part.byteLength))
      else throw new TypeError('Unsupported Blob part')
    }
    this.#bytes = concatBytes(chunks)
    // 规范:非 HTTP token 字符 → 置空
    const type = String(options.type ?? '')
    this.type = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+(\/[!#$%&'*+.^_`|~0-9A-Za-z-]+)?$/.test(type)
      ? type.toLowerCase()
      : ''
  }

  get size(): number {
    return this.#bytes.byteLength
  }

  /** 内部访问口(多部分序列化用),非公共 API。 */
  get _bytes(): Uint8Array {
    return this.#bytes
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return Promise.resolve(toArrayBuffer(this.#bytes))
  }

  text(): Promise<string> {
    return Promise.resolve(new TextDecoder().decode(this.#bytes))
  }

  slice(start?: number, end?: number, contentType?: string): Blob {
    const from = start ?? 0
    const to = end ?? this.#bytes.byteLength
    const range = this.#bytes.subarray(
      Math.max(0, Math.min(from, this.#bytes.byteLength)),
      Math.max(0, Math.min(to, this.#bytes.byteLength)),
    )
    return new Blob([range], { type: contentType ?? this.type })
  }

  toString(): string {
    return '[object Blob]'
  }
}

export interface FileOptions extends BlobOptions {
  lastModified?: number
}

export class File extends Blob {
  readonly name: string
  readonly lastModified: number

  constructor(parts: BlobPart[], name: string, options: FileOptions = {}) {
    super(parts, options)
    this.name = String(name)
    this.lastModified = options.lastModified ?? Date.now()
  }
}

interface FormDataEntry {
  name: string
  value: string | Blob
  filename?: string
}

/**
 * WHATWG FormData 子集(纯内存)。
 * 注意:包含 File 的 FormData 经 fetch 桥序列化后可发送,
 * 但磁盘文件仍应使用 wx.uploadFile 适配层。
 */
export class FormData {
  #entries: FormDataEntry[] = []

  append(name: string, value: string | Blob, filename?: string): void {
    this.#entries.push({
      name: String(name),
      value,
      filename: this.#resolveFilename(value, filename),
    })
  }

  set(name: string, value: string | Blob, filename?: string): void {
    const key = String(name)
    this.#entries = this.#entries.filter((e) => e.name !== key)
    this.append(key, value, filename)
  }

  delete(name: string): void {
    const key = String(name)
    this.#entries = this.#entries.filter((e) => e.name !== key)
  }

  get(name: string): FormDataEntryValue | null {
    const entry = this.#entries.find((e) => e.name === String(name))
    return entry ? entry.value : null
  }

  getAll(name: string): FormDataEntryValue[] {
    return this.#entries.filter((e) => e.name === String(name)).map((e) => e.value)
  }

  has(name: string): boolean {
    return this.#entries.some((e) => e.name === String(name))
  }

  forEach(cb: (value: FormDataEntryValue, name: string, parent: FormData) => void): void {
    for (const entry of [...this.#entries]) cb(entry.value, entry.name, this)
  }

  *entries(): IterableIterator<[string, FormDataEntryValue]> {
    for (const entry of [...this.#entries]) yield [entry.name, entry.value]
  }

  *keys(): IterableIterator<string> {
    for (const entry of [...this.#entries]) yield entry.name
  }

  *values(): IterableIterator<FormDataEntryValue> {
    for (const entry of [...this.#entries]) yield entry.value
  }

  [Symbol.iterator](): IterableIterator<[string, FormDataEntryValue]> {
    return this.entries()
  }

  /** 内部访问口:multipart 序列化需要 filename,entries() 会丢掉它,非公共 API。 */
  _entriesRaw(): readonly FormDataEntry[] {
    return this.#entries
  }

  #resolveFilename(value: string | Blob, filename?: string): string | undefined {
    if (typeof value === 'string') return undefined
    if (filename !== undefined) return String(filename)
    if (value instanceof File) return value.name
    return 'blob'
  }
}

export type FormDataEntryValue = string | Blob
