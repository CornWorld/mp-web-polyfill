import {
  createServer,
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { readFileSync } from 'node:fs'
import type {
  WxChunkReceived,
  WxHeadersReceived,
  WxLike,
  WxRequestOptions,
  WxRequestTask,
  WxStorageSync,
  WxUploadFileOptions,
  WxUploadFileTask,
} from '@cornworld/mp-core'

export interface CapturedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: Buffer
}

export interface WxMockOptions {
  /** 模拟 wx storage 的总配额上限(字节),默认 10MB */
  maxTotalStorageBytes?: number
}

export interface WxMock {
  wx: WxLike
  storage: WxStorageSync
  port: number
  origin: string
  requests: CapturedRequest[]
  /** 每个测试自定义响应行为;默认 404 */
  handler: (req: IncomingMessage, res: ServerResponse, body: Buffer) => void
  close(): Promise<void>
}

function flattenHeaders(headers: IncomingMessage['headers']): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value
  }
  return out
}

function toAb(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer
}

export function createWxStorageMock(options: WxMockOptions = {}): WxStorageSync {
  const store = new Map<string, unknown>()
  const maxTotal = options.maxTotalStorageBytes ?? 10 * 1024 * 1024
  const sizeOf = (value: unknown) => Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8')
  return {
    getStorageSync: (key) => (store.has(key) ? store.get(key) : ''),
    setStorageSync: (key, value) => {
      let total = sizeOf(value)
      for (const [k, v] of store) if (k !== key) total += sizeOf(v)
      if (total > maxTotal) {
        // 真机 errMsg 形如 "setStorageSync:fail exceed storage max size 10240Kb"
        throw new Error('setStorageSync:fail exceed storage max size 10240Kb')
      }
      store.set(key, JSON.parse(JSON.stringify(value)))
    },
    removeStorageSync: (key) => {
      store.delete(key)
    },
    getStorageInfoSync: () => ({
      keys: [...store.keys()],
      currentSize: [...store.values()].reduce<number>((sum, v) => sum + sizeOf(v), 0) / 1024,
      limitSize: maxTotal / 1024,
    }),
  }
}

function createRequestMock(ctx: { origin: string; requests: CapturedRequest[] }) {
  return function request(options: WxRequestOptions): WxRequestTask {
    const headerListeners: ((r: WxHeadersReceived) => void)[] = []
    const chunkListeners: ((r: WxChunkReceived) => void)[] = []
    let settled = false
    let aborted = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastStatus = 0
    let lastHeaders: Record<string, string> = {}
    const buffered: Buffer[] = []

    const settleFail = (errMsg: string) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      options.fail?.({ errMsg })
    }

    const settleSuccess = (data: ArrayBuffer | string) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      options.success?.({ data, statusCode: lastStatus, header: lastHeaders })
    }

    const parsed = new URL(options.url, ctx.origin)
    const nodeReq: ClientRequest = httpRequest(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: (options.method ?? 'GET').toUpperCase(),
        headers: { ...(options.header ?? {}) },
      },
      (res) => {
        lastStatus = res.statusCode ?? 0
        lastHeaders = flattenHeaders(res.headers)
        for (const cb of headerListeners) cb({ statusCode: lastStatus, header: lastHeaders })
        res.on('data', (chunk: Buffer) => {
          if (aborted) return
          buffered.push(chunk)
          if (options.enableChunked) {
            for (const cb of chunkListeners) cb({ data: toAb(chunk) })
          }
        })
        res.on('end', () => {
          if (aborted) return
          const full = Buffer.concat(buffered)
          settleSuccess(
            options.responseType === 'arraybuffer' ? toAb(full) : full.toString('utf8'),
          )
        })
        res.on('error', () => settleFail('request:fail'))
      },
    )

    nodeReq.on('error', (err: Error & { code?: string }) => {
      settleFail(
        aborted ? 'request:fail abort' : `request:fail ${err.message || err.code || 'network error'}`,
      )
    })

    const data = options.data
    if (typeof data === 'string') nodeReq.write(Buffer.from(data, 'utf8'))
    else if (data instanceof ArrayBuffer) nodeReq.write(Buffer.from(data))
    else if (ArrayBuffer.isView(data))
      nodeReq.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
    else if (data !== undefined && data !== null)
      nodeReq.write(Buffer.from(JSON.stringify(data), 'utf8'))
    nodeReq.end()

    if (options.timeout !== undefined) {
      timer = setTimeout(() => {
        nodeReq.destroy()
        settleFail('request:fail timeout')
      }, options.timeout)
    }

    return {
      abort() {
        if (aborted || settled) return
        aborted = true
        nodeReq.destroy()
        settleFail('request:fail abort')
      },
      onHeadersReceived(cb) {
        headerListeners.push(cb)
      },
      onChunkReceived(cb) {
        chunkListeners.push(cb)
      },
    }
  }
}

function createUploadFileMock(ctx: { origin: string; requests: CapturedRequest[] }) {
  return function uploadFile(options: WxUploadFileOptions): WxUploadFileTask {
    let settled = false

    const settleFail = (errMsg: string) => {
      if (settled) return
      settled = true
      options.fail?.({ errMsg })
    }

    let fileBytes: Buffer
    try {
      fileBytes = readFileSync(options.filePath)
    } catch (err) {
      settleFail(`uploadFile:fail 读取文件失败 ${String(err)}`)
      return { abort() {} }
    }

    const boundary = `----wxMockUpload${Math.random().toString(36).slice(2)}`
    const parts: Buffer[] = []
    const push = (text: string) => parts.push(Buffer.from(text, 'utf8'))

    for (const [key, value] of Object.entries(options.formData ?? {})) {
      push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n`)
      push(value)
      push('\r\n')
    }
    push(`--${boundary}\r\nContent-Disposition: form-data; name="${options.name}"; filename="${options.filePath.split('/').pop() ?? 'file'}"\r\n`)
    push('Content-Type: application/octet-stream\r\n\r\n')
    parts.push(fileBytes)
    push('\r\n')
    push(`--${boundary}--\r\n`)

    const parsed = new URL(options.url, ctx.origin)
    const nodeReq = httpRequest(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        headers: {
          ...(options.header ?? {}),
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'content-length': Buffer.concat(parts).byteLength,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          if (settled) return
          settled = true
          options.success?.({ statusCode: res.statusCode ?? 0, data: Buffer.concat(chunks).toString('utf8') })
        })
        res.on('error', () => settleFail('uploadFile:fail'))
      },
    )
    nodeReq.on('error', (err: Error) => settleFail(`uploadFile:fail ${err.message}`))

    for (const part of parts) nodeReq.write(part)
    nodeReq.end()

    return {
      abort() {
        nodeReq?.destroy()
        settleFail('uploadFile:fail abort')
      },
    }
  }
}

/**
 * 基于 Node http 的 wx.request 模拟宿主。
 * enableChunked 时逐块回调 onChunkReceived(与真机一致,data 为 ArrayBuffer),
 * 非 chunked 只在 success 给全量 data —— 与真实小程序行为差异一致。
 */
export async function startWxMock(options: WxMockOptions = {}): Promise<WxMock> {
  const requests: CapturedRequest[] = []
  const storage = createWxStorageMock(options)
  const mock = {
    handler: ((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
    }) as WxMock['handler'],
  }

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      requests.push({
        url: `http://${req.headers.host}${req.url ?? '/'}`,
        method: req.method ?? 'GET',
        headers: flattenHeaders(req.headers),
        body,
      })
      mock.handler(req, res, body)
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('mock server failed to listen')

  const result: WxMock = {
    wx: {
      ...storage,
      request: createRequestMock({ origin: `http://127.0.0.1:${address.port}`, requests }),
      uploadFile: createUploadFileMock({ origin: `http://127.0.0.1:${address.port}`, requests }),
    },
    storage,
    port: address.port,
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    get handler() {
      return mock.handler
    },
    set handler(fn: WxMock['handler']) {
      mock.handler = fn
    },
    close: () =>
      new Promise((resolve) => {
        // 杀掉 keep-alive 连接,否则 close 会等挂起的 SSE 长连接
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
  return result
}
