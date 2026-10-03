import type { URLSearchParamsInstance } from '@cornworld/mp-url'
import { URLSearchParams } from '@cornworld/mp-url'
import { utf8Encode } from '@cornworld/mp-text-encoding'
import { BodyBase } from './body'
import { Blob, FormData } from './form-data'
import { Headers, type HeadersInit } from './headers'
import { serializeFormData } from './multipart'

export type MPResponseInit = {
  status?: number
  statusText?: string
  headers?: HeadersInit
}

export type MPBodyInit =
  string | ArrayBuffer | ArrayBufferView | Blob | FormData | URLSearchParamsInstance | null

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
  throw new TypeError('Unsupported response body type')
}

const VALID_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export class Response extends BodyBase {
  readonly status: number
  readonly statusText: string
  readonly headers: Headers
  readonly ok: boolean
  readonly redirected = false
  readonly type: 'basic' | 'error' = 'basic'
  private _url = ''

  get url(): string {
    return this._url
  }

  /** 内部访问口:fetch 桥设置最终 URL,非公共 API。 */
  _setUrl(url: string): void {
    this._url = url
  }

  constructor(body: MPBodyInit = null, init: MPResponseInit = {}) {
    const status = init.status ?? 200
    if (!Number.isInteger(status) || status < 200 || status > 599) {
      throw new RangeError(`The status provided (${status}) is outside the range [200, 599].`)
    }
    const serialized = serializeBody(body)
    super({ bytes: serialized?.bytes ?? null, contentType: serialized?.contentType })
    this.status = status
    this.statusText = String(init.statusText ?? '')
    this.headers = new Headers(init.headers)
    const existing = this.headers.get('content-type')
    if (serialized?.contentType !== undefined && (existing === null || existing === '')) {
      this.headers.set('content-type', serialized.contentType)
    }
    this.ok = status >= 200 && status < 300
  }

  /** 内部构造口:绕开 status 校验(error() 需要 status 0)。 */
  private static makeRaw(params: { bytes?: Uint8Array | null; status: number }): Response {
    const response = new Response(null, { status: 200 })
    ;(response as unknown as { status: number }).status = params.status
    return response
  }

  static error(): Response {
    return Response.makeRaw({ status: 0 })
  }

  static json(data: unknown, init: MPResponseInit = {}): Response {
    return new Response(utf8Encode(JSON.stringify(data)), {
      ...init,
      headers: new Headers(init.headers).has('content-type')
        ? init.headers
        : { ...normalizeInit(init.headers), 'content-type': 'application/json' },
    })
  }

  static redirect(url: string, status = 302): Response {
    if (!VALID_REDIRECT_STATUSES.has(status)) {
      throw new RangeError('Invalid redirect status code.')
    }
    const response = new Response(null, { status })
    response.headers.set('location', url)
    return response
  }

  override toString(): string {
    return '[object Response]'
  }
}

function normalizeInit(headers?: HeadersInit): Record<string, string> {
  const parsed = new Headers(headers)
  const out: Record<string, string> = {}
  for (const [name, value] of parsed.entries()) out[name] = value
  return out
}
