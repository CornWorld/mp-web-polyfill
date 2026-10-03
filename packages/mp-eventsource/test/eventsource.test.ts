import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startWxMock, type WxMock } from '@cornworld/wx-mock'
import { setWxForTesting } from '@cornworld/mp-core'
import { EventSource, createParser } from '@cornworld/mp-eventsource'

interface FormatCase {
  name: string
  stream: string | string[]
  events: { event?: string; id?: string; data: string }[]
  lastId?: string
  retry?: number
  /** 引擎与 WHATWG 规范的已知偏差,契约测试按引擎实际行为断言,客户端层再对齐规范 */
  deviation?: 'engine-emits-empty-data'
}

const cases: FormatCase[] = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./fixtures/wpt-eventstream-format.json', import.meta.url)),
    'utf8',
  ),
)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitFor(cond: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeout) throw new Error('waitFor timeout')
    await sleep(10)
  }
}

// ———— T2:外部引擎 eventsource-parser 的契约面(WPT format-* 移植) ————
describe('SSE 线格式解析(WPT format-* 移植,引擎 eventsource-parser)', () => {
  for (const c of cases) {
    it(`format: ${c.name}`, () => {
      const events: { event?: string; id?: string; data: string }[] = []
      let lastId = ''
      let retry: number | undefined
      const parser = createParser({
        onEvent: (msg) =>
          events.push({
            // '' 与 undefined 在客户端语义等价(|| 'message'),这里归一化断言
            event: msg.event === '' ? undefined : msg.event,
            id: msg.id,
            data: msg.data,
          }),
        onId: (id) => {
          lastId = id
        },
        onRetry: (ms) => {
          retry = ms
        },
      })
      const chunks = Array.isArray(c.stream) ? c.stream : [c.stream]
      for (const chunk of chunks) parser.feed(chunk)
      if (c.deviation === 'engine-emits-empty-data') {
        // 引擎偏差:空 data 也派发;客户端层(#dispatchMessage 守卫)再对齐规范
        expect(events.map((e) => e.data)).toEqual([''])
        return
      }
      expect(events).toEqual(c.events)
      expect(lastId).toBe(c.lastId ?? '')
      if (c.retry !== undefined) expect(retry).toBe(c.retry)
    })
  }
})

// ———— B 层:客户端状态机(wx-mock E2E) ————
let mock: WxMock

beforeEach(async () => {
  mock = await startWxMock()
  setWxForTesting(mock.wx)
})

afterEach(async () => {
  setWxForTesting(undefined)
  await mock.close()
})

describe('EventSource 客户端(传输 + 重连状态机)', () => {
  it('open → message → 断连自动重连 → close 终止', async () => {
    let connections = 0
    mock.handler = (_req, res) => {
      connections += 1
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('retry: 20\n\n')
      res.write(`data: hello-${connections}\n\n`)
      res.end()
    }
    const es = new EventSource(`${mock.origin}/sse`, { mp: { reconnectionTime: 20 } })
    const messages: string[] = []
    const errors: number[] = []
    es.onmessage = (ev) => messages.push(ev.data)
    es.onerror = () => errors.push(1)

    await waitFor(() => messages.length >= 2)
    expect(messages[0]).toBe('hello-1')
    expect(messages[1]).toBe('hello-2')
    expect(mock.requests.length).toBeGreaterThanOrEqual(2)
    expect(errors.length).toBeGreaterThanOrEqual(1)

    es.close()
    expect(es.readyState).toBe(EventSource.CLOSED)
    const count = mock.requests.length
    await sleep(80)
    expect(mock.requests.length).toBe(count)
  })

  it('Last-Event-ID 随重连回传,空 id 时停止回传', async () => {
    const seenIds: (string | undefined)[] = []
    mock.handler = (_req, res) => {
      seenIds.push(_req.headers['last-event-id'] as string | undefined)
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('retry: 20\n\n')
      if (seenIds.length === 1) res.write('id: 42\ndata: a\n\n')
      else if (seenIds.length === 2) res.write('id:\ndata: b\n\n')
      else res.write('data: c\n\n')
      res.end()
    }
    const es = new EventSource(`${mock.origin}/sse`, { mp: { reconnectionTime: 20 } })
    await waitFor(() => seenIds.length >= 3)
    expect(seenIds[0]).toBeUndefined()
    expect(seenIds[1]).toBe('42')
    // 规范:lastEventId 为空串时不发送 Last-Event-ID 头
    expect(seenIds[2]).toBeUndefined()
    es.close()
  })

  it('MIME 门控:非 text/event-stream 不产生 message', async () => {
    mock.handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    }
    const errors: number[] = []
    const messages: unknown[] = []
    const es = new EventSource(`${mock.origin}/json`, { mp: { reconnectionTime: 30 } })
    es.onerror = () => errors.push(1)
    es.onmessage = (ev) => messages.push(ev)
    await waitFor(() => errors.length >= 1)
    expect(messages).toHaveLength(0)
    es.close()
  })

  it('自定义事件类型分发 + UTF-8 多字节跨 chunk', async () => {
    mock.handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('event: custom\ndata: 自定义\n\n')
      res.write('data: multi\ndata: line\n\n')
      // 保持连接
    }
    const es = new EventSource(`${mock.origin}/custom`)
    const custom: string[] = []
    const messages: string[] = []
    es.addEventListener('custom', (ev) => custom.push((ev as { data: string }).data))
    es.onmessage = (ev) => messages.push(ev.data)
    await waitFor(() => custom.length >= 1 && messages.length >= 1)
    expect(custom).toEqual(['自定义'])
    expect(messages).toEqual(['multi\nline'])
    es.close()
  })

  it('非 http(s) 协议抛 SyntaxError', () => {
    expect(() => new EventSource('ftp://example.com')).toThrowError(SyntaxError)
  })
})
