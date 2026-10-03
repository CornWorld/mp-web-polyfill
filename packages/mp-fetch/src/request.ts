import { utf8Encode } from '@cornworld/mp-text-encoding'
import type { URLSearchParamsInstance } from '@cornworld/mp-url'
import { URL as MPURL, URLSearchParams } from '@cornworld/mp-url'
import { AbortController, type AbortSignal } from './abort'
import { BodyBase } from './body'
import { Blob, FormData } from './form-data'
import { Headers, type HeadersInit } from './headers'
import { serializeFormData } from './multipart'

export type MPBodyInit =
  | string
  | ArrayBuffer
  | ArrayBufferView
  | Blob
  | FormData
  | URLSearchParamsInstance
  | null

export interface MPRequestInit {
  method?: string
  headers?: HeadersInit
  body?: MPBodyInit
  signal?: AbortSignal | null
  /** 小程序特有扩展:timeout(毫秒)/ enableChunked(流式读取响应) */
  mp?: { timeout?: number; enableChunked?: boolean }
}

export type MPRequestInfo = string | MPURL | Request

function serializeBody(body: MPBodyInit): { bytes: Uint8Array; contentType?: string } | null {
  if (body === undefined || body === null) return null
  if (typeof body === 'string')
    return { bytes: utf8Encode(body), contentType: 'text/plain;charset=UTF-8' }
  if (body instanceof Blob) return { bytes: body._bytes, contentType: body.type || undefined }
  if (body instanceof FormData) return serializeFormData(body)
  if (body instanceof URLSearchParams)
    return {
      bytes: utf8Encode(body.toString()),
      contentType: 'application/x-www-form-urlencoded;charset=UTF-8',
    }
  if (body instanceof ArrayBuffer) return { bytes: new Uint8Array(body) }
  if (ArrayBuffer.isView(body))
    return { bytes: new Uint8Array(body.buffer, body.byteOffset, body.byteLength) }
  throw new TypeError('Unsupported request body type')
}

export class Request extends BodyBase {
  readonly method: string
  readonly url: string
  readonly headers: Headers
  readonly signal: AbortSignal
  readonly mp: MPRequestInit['mp']

  constructor(input: MPRequestInfo, init: MPRequestInit = {}) {
    const url = new MPURL(input instanceof Request ? input.url : String(input))
    const method = String(
      init.method ?? (input instanceof Request ? input.method : 'GET'),
    ).toUpperCase()
    if ((method === 'GET' || method === 'HEAD') && init.body !== undefined && init.body !== null) {
      throw new TypeError(`Request with ${method} method cannot have a body.`)
    }
    const serialized = serializeBody(init.body ?? null)

    super({ bytes: serialized?.bytes ?? null, contentType: serialized?.contentType })

    this.url = url.href
    this.method = method
    this.headers = new Headers(input instanceof Request ? input.headers : undefined)
    if (init.headers) {
      const parsed = new Headers(init.headers)
      for (const [name, value] of parsed.entries()) this.headers.set(name, value)
    }
    if (serialized?.contentType !== undefined) {
      const existing = this.headers.get('content-type')
      // multipart 的 boundary 必须与序列化字节一致 → 即使已有(可能为空)也覆盖;
      // 其余类型仅在缺失或为空时补默认值
      const shouldSet =
        existing === null ||
        existing === '' ||
        serialized.contentType.startsWith('multipart/form-data')
      if (shouldSet) this.headers.set('content-type', serialized.contentType)
    }
    this.signal =
      init.signal ??
      (input instanceof Request ? input.signal : new AbortController().signal)
    this.mp = init.mp ?? (input instanceof Request ? input.mp : undefined)
  }
}
