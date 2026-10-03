import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReadableStream } from 'web-streams-polyfill'
import { startWxMock, type WxMock } from '@cornworld/wx-mock'
import { setWxForTesting, MPAbortError } from '@cornworld/mp-core'
import { URLSearchParams } from '@cornworld/mp-url'
import {
  AbortController,
  Blob,
  FormData,
  Headers,
  Request,
  Response,
  fetch,
  setReadableStreamClass,
  isStreamingSupported,
} from '@cornworld/mp-fetch'

// ———— T1 冒烟:外部引擎 web-streams-polyfill 的 API 面(防升级破坏) ————
describe('streams 引擎冒烟(web-streams-polyfill)', () => {
  it('ReadableStream 支持注入 + enqueue/close 读取循环', async () => {
    setReadableStreamClass(
      ReadableStream as unknown as ConstructorParameters<typeof Object>[0] extends never
        ? never
        : // eslint-disable-next-line @typescript-eslint/no-explicit-any
          any,
    )
    expect(isStreamingSupported()).toBe(true)
  })
})

// ———— A 层:纯规约逻辑(零 mock) ————
describe('Headers', () => {
  it('大小写不敏感 + append 多值合并', () => {
    const h = new Headers()
    h.append('X-Token', 'a')
    h.append('x-token', 'b')
    expect(h.get('X-TOKEN')).toBe('a, b')
    h.set('X-Token', 'c')
    expect(h.get('x-token')).toBe('c')
  })

  it('迭代按键名排序', () => {
    const h = new Headers({ b: '2', a: '1' })
    expect([...h.keys()]).toEqual(['a', 'b'])
    expect([...h.entries()]).toEqual([
      ['a', '1'],
      ['b', '2'],
    ])
  })

  it('可从 Headers / 数组初始化', () => {
    const base = new Headers({ a: '1' })
    const h = new Headers(base)
    expect(h.get('a')).toBe('1')
    expect(new Headers([['x', 'y']] as const).get('x')).toBe('y')
  })
})

describe('Blob / FormData / multipart 序列化', () => {
  it('Blob text/size/slice', async () => {
    const blob = new Blob(['小', '程序'], { type: 'text/plain' })
    expect(blob.size).toBe(9) // 3 个汉字 × 3 字节
    expect(await blob.text()).toBe('小程序')
    expect(blob.slice(0, 3).size).toBe(3)
  })

  it('FormData 序列化为 multipart,字段名转义引号', async () => {
    const fd = new FormData()
    fd.append('name', '张三')
    fd.append('we"ird', 'v')
    fd.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'a.png')
    const request = new Request('http://example.com/upload', { method: 'POST', body: fd })
    expect(request.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/)
    const text = new TextDecoder().decode(request._bodyBytes ?? new Uint8Array())
    expect(text).toContain('Content-Disposition: form-data; name="name"')
    expect(text).toContain('name="we%22ird"')
    expect(text).toContain('filename="a.png"')
    expect(text).toContain('Content-Type: image/png')
  })

  it('URLSearchParams 请求体使用 urlencoded Content-Type', () => {
    const request = new Request('http://example.com', {
      method: 'POST',
      body: new URLSearchParams('a=1'),
    })
    expect(request.headers.get('content-type')).toBe(
      'application/x-www-form-urlencoded;charset=UTF-8',
    )
  })

  it('GET/HEAD 不允许携带 body', () => {
    expect(() => new Request('http://example.com', { body: 'x' })).toThrowError(TypeError)
  })
})

describe('Request / Response 语义', () => {
  it('body 只能消费一次', async () => {
    const response = new Response('hello')
    expect(await response.text()).toBe('hello')
    await expect(response.text()).rejects.toThrowError(TypeError)
  })

  it('Response.json() 静态构造', async () => {
    const response = Response.json({ ok: 1 })
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual({ ok: 1 })
  })

  it('非法 status 抛 RangeError,redirect 校验状态码', () => {
    expect(() => new Response('x', { status: 199 })).toThrowError(RangeError)
    expect(() => Response.redirect('/x', 200)).toThrowError(RangeError)
    expect(Response.redirect('/x', 307).headers.get('location')).toBe('/x')
  })

  it('AbortController:abort 设置 reason 并触发监听', () => {
    const controller = new AbortController()
    const events: string[] = []
    controller.signal.addEventListener('abort', () => events.push('fired'), { once: true })
    controller.abort()
    expect(controller.signal.aborted).toBe(true)
    expect(events).toEqual(['fired'])
    expect(() => controller.signal.throwIfAborted()).toThrowError(MPAbortError)
  })
})

// ———— B 层:wx.request 传输桥协议(wx-mock + 本地 Node http) ————
let mock: WxMock

beforeEach(async () => {
  mock = await startWxMock()
  setWxForTesting(mock.wx)
})

afterEach(async () => {
  setWxForTesting(undefined)
  await mock.close()
})

afterAll(() => {
  setReadableStreamClass(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    undefined as any,
  )
})

describe('fetch 桥(传输协议)', () => {
  it('GET JSON:ok/status/header/url 全对齐', async () => {
    mock.handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    }
    const response = await fetch(`${mock.origin}/api/records`)
    expect(response.status).toBe(200)
    expect(response.ok).toBe(true)
    expect(response.url).toBe(`${mock.origin}/api/records`)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual({ ok: true })
    expect(mock.requests[0]?.method).toBe('GET')
  })

  it('POST JSON body 原样到达服务端', async () => {
    mock.handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    }
    await fetch(`${mock.origin}/api/records`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '会议室' }),
    })
    expect(mock.requests[0]?.body.toString('utf8')).toBe(JSON.stringify({ title: '会议室' }))
    expect(mock.requests[0]?.headers['content-type']).toBe('application/json')
  })

  it('非 2xx 不抛错,返回 Response(规范行为)', async () => {
    mock.handler = (_req, res) => {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('nope')
    }
    const response = await fetch(`${mock.origin}/missing`)
    expect(response.status).toBe(404)
    expect(response.ok).toBe(false)
    expect(await response.text()).toBe('nope')
  })

  it('二进制响应:responseType arraybuffer 全量到达', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252])
    mock.handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.end(Buffer.from(bytes))
    }
    const response = await fetch(`${mock.origin}/bin`)
    const buffer = await response.arrayBuffer()
    expect([...new Uint8Array(buffer)]).toEqual([...bytes])
  })

  it('chunked 流式:ReadableStream 逐块读取', async () => {
    setReadableStreamClass(ReadableStream as never)
    mock.handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: first\n\n')
      res.write('data: second\n\n')
      res.end()
    }
    const response = await fetch(`${mock.origin}/sse`, { mp: { enableChunked: true } })
    const reader = (response.body as unknown as { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } }).getReader()
    let text = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text += new TextDecoder().decode(value)
    }
    expect(text).toContain('data: first\n\n')
    expect(text).toContain('data: second\n\n')
  })

  it('chunked 无 ReadableStream 时退化为缓冲模式', async () => {
    setReadableStreamClass(undefined as never)
    mock.handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.write('a')
      res.write('b')
      res.end('c')
    }
    const response = await fetch(`${mock.origin}/chunked`, { mp: { enableChunked: true } })
    expect(await response.text()).toBe('abc')
  })

  it('abort 中断长连接 → AbortError', async () => {
    mock.handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: x\n\n')
      // 不 end,保持连接
    }
    const controller = new AbortController()
    const pending = fetch(`${mock.origin}/long`, { signal: controller.signal })
    await new Promise((r) => setTimeout(r, 50))
    controller.abort()
    await expect(pending).rejects.toThrowError(MPAbortError)
  })

  it('网络失败 → TypeError(fetch 规范行为)', async () => {
    await expect(fetch('http://127.0.0.1:1/')).rejects.toThrowError(TypeError)
  })

  it('mp.timeout 超时 → TypeError', async () => {
    mock.handler = (_req, res) => {
      res.writeHead(200)
      res.write('partial')
      // 挂住不 end
    }
    await expect(
      fetch(`${mock.origin}/slow`, { mp: { timeout: 60 } }),
    ).rejects.toThrowError(TypeError)
  })

  it('已中止的 signal:立即 reject,不发起请求', async () => {
    const controller = new AbortController()
    controller.abort(new MPAbortError('pre-aborted'))
    await expect(fetch(`${mock.origin}/x`, { signal: controller.signal })).rejects.toThrowError(
      MPAbortError,
    )
    expect(mock.requests).toHaveLength(0)
  })

  it('多值响应头以逗号合并', async () => {
    mock.handler = (_req, res) => {
      res.writeHead(200, { 'x-multi': ['a', 'b'] })
      res.end('')
    }
    const response = await fetch(`${mock.origin}/multi`)
    expect(response.headers.get('x-multi')).toBe('a, b')
  })
})
