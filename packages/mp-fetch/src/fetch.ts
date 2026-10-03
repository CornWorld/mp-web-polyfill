import {
  getWx,
  throwIfAborted,
  toArrayBuffer,
  concatBytes,
  MPAbortError,
} from '@cornworld/mp-core'
import { TextEncoder } from '@cornworld/mp-text-encoding'
import { URL as MPURL } from '@cornworld/mp-url'
import { Headers, headersToRecord } from './headers'
import { Request, type MPRequestInfo, type MPRequestInit } from './request'
import { Response } from './response'
import { createPushStream, isStreamingSupported } from './streams'

export type { MPRequestInit, MPRequestInfo, MPBodyInit } from './request'
export type { MPResponseInit } from './response'

/**
 * WHATWG fetch 桥:输入输出语义对齐 fetch 规范,底层单次 wx.request。
 * - 非 chunked:headers 到达即记录,success 后以全量字节 resolve
 * - enableChunked:有 ReadableStream 实现时 headers 到达即 resolve(流式 body);
 *   否则退化为缓冲模式(success 后 resolve)
 * - 小程序无 CORS 概念,redirect 由 wx 自动跟随(redirected 恒为 false)
 */
export function fetch(input: MPRequestInfo, init: MPRequestInit = {}): Promise<Response> {
  const wx = getWx()
  if (!wx) {
    return Promise.reject(new TypeError('fetch: 未找到 wx 宿主全局对象(非小程序运行时)'))
  }

  let request: Request
  try {
    request = new Request(input, init)
  } catch (err) {
    return Promise.reject(err)
  }

  let scheme = ''
  try {
    scheme = new MPURL(request.url).protocol
  } catch {
    // 保持空串,下方统一按不支持 scheme 处理
  }
  if (scheme !== 'http:' && scheme !== 'https:') {
    return Promise.reject(new TypeError(`fetch: 仅支持 http/https,收到 ${request.url}`))
  }

  return new Promise<Response>((resolve, reject) => {
    const signal = request.signal
    try {
      throwIfAborted(signal)
    } catch (err) {
      reject(err)
      return
    }

    let settled = false
    let statusCode = 0
    let responseHeaders: Headers | undefined
    let pushStream: ReturnType<typeof createPushStream> | undefined
    let resolvedWithStream = false
    const bufferedChunks: Uint8Array[] = []
    const mp = request.mp ?? {}
    const enableChunked = mp.enableChunked === true

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }

    const buildResponse = (bytes: Uint8Array | null): Response => {
      const response = new Response(bytes, {
        status: statusCode,
        headers: responseHeaders ?? new Headers(),
      })
      response._setUrl(request.url)
      return response
    }

    const failWith = (errMsg: string) => {
      settle(() => {
        if (signal.aborted || errMsg.includes('abort')) {
          reject(signal.reason instanceof Error ? signal.reason : new MPAbortError())
        } else {
          reject(new TypeError(`fetch failed: ${errMsg}`))
        }
      })
      pushStream?.error(new MPAbortError(errMsg))
    }

    let task: ReturnType<typeof wx.request>
    try {
      task = wx.request({
        url: request.url,
        method: request.method,
        header: headersToRecord(request.headers),
        data: request._bodyBytes ? toArrayBuffer(request._bodyBytes) : undefined,
        responseType: 'arraybuffer',
        enableChunked,
        timeout: mp.timeout,
        success: (res) => {
          statusCode = res.statusCode
          responseHeaders = new Headers(res.header ?? {})
          if (enableChunked && resolvedWithStream) {
            pushStream?.close()
            return
          }
          settle(() => {
            const bytes =
              res.data instanceof ArrayBuffer
                ? new Uint8Array(res.data)
                : new TextEncoder().encode(String(res.data))
            resolve(buildResponse(enableChunked ? concatBytes(bufferedChunks) : bytes))
          })
        },
        fail: (err) => {
          failWith(err.errMsg)
        },
      })
    } catch (err) {
      reject(err instanceof Error ? err : new TypeError('fetch failed: wx.request threw'))
      return
    }

    try {
      task.onHeadersReceived?.((r) => {
        statusCode = r.statusCode
        responseHeaders = new Headers(r.header ?? {})
        if (enableChunked && isStreamingSupported()) {
          const handle = createPushStream()
          if (handle) {
            pushStream = handle
            const response = new Response(null, {
              status: statusCode,
              headers: responseHeaders,
            })
            response._setUrl(request.url)
            response._attachStream(handle)
            resolvedWithStream = true
            settle(() => resolve(response))
          }
        }
      })
      task.onChunkReceived?.((r) => {
        const chunk = new Uint8Array(r.data)
        bufferedChunks.push(chunk)
        pushStream?.push(chunk)
      })
    } catch {
      // 旧基础库无 chunked 事件:退化为纯缓冲
    }

    if (!signal.aborted) {
      signal.addEventListener(
        'abort',
        () => {
          task.abort()
        },
        { once: true },
      )
    }
  })
}
