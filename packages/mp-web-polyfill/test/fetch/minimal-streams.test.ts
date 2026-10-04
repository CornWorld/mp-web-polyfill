import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startWxMock, type WxMock } from '@cornworld/wx-mock'
import { setWxForTesting } from '../../src/core'
import { MinimalReadableStream } from '../../src/fetch/minimal-streams'
import { fetch, setReadableStreamClass } from '../../src/fetch'
import type { MinimalReadableStreamController } from '../../src/fetch/minimal-streams'

/**
 * T4:内置最小流(默认引擎)。覆盖本家族的流式消费面:
 * 生产端 enqueue/close/error,消费端 getReader().read()。
 * 完整 Streams 规范(web-streams-polyfill)经 ./streams/full 按需注入,
 * 本文件不触碰它(文件级隔离)。
 */

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../')

// —— 单元:流语义 ——

function textOf(stream: MinimalReadableStream): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  return (async () => {
    let out = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      out += decoder.decode(value, { stream: true })
    }
    return out + decoder.decode()
  })()
}

describe('MinimalReadableStream(默认流引擎,T4)', () => {
  it('先 enqueue 后 read:队列顺序消费', async () => {
    let controller!: MinimalReadableStreamController
    const stream = new MinimalReadableStream({
      start(c) {
        controller = c
      },
    })
    controller.enqueue(new TextEncoder().encode('a'))
    controller.enqueue(new TextEncoder().encode('b'))
    const reader = stream.getReader()
    const first = await reader.read()
    const second = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe('a')
    expect(new TextDecoder().decode(second.value)).toBe('b')
  })

  it('先 read 后 enqueue:挂起读在数据到达时落定', async () => {
    const stream = new MinimalReadableStream({
      start(c) {
        setTimeout(() => c.enqueue(new TextEncoder().encode('迟到')), 10)
      },
    })
    const reader = stream.getReader()
    const result = await reader.read()
    expect(new TextDecoder().decode(result.value)).toBe('迟到')
  })

  it('close 后 read 落定 done;close 前的排队数据仍可读', async () => {
    const stream = new MinimalReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('尾'))
        c.close()
      },
    })
    const reader = stream.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('尾')
    expect((await reader.read()).done).toBe(true)
    expect((await reader.read()).done).toBe(true)
  })

  it('error 后 read reject,新 read 持续 reject', async () => {
    const stream = new MinimalReadableStream({
      start(c) {
        setTimeout(() => c.error(new Error('boom')), 5)
      },
    })
    const reader = stream.getReader()
    await expect(reader.read()).rejects.toThrowError('boom')
    await expect(reader.read()).rejects.toThrowError('boom')
  })

  it('锁语义:重复 getReader 抛错,releaseLock 后可重新获取', async () => {
    const stream = new MinimalReadableStream({
      start() {},
    })
    const reader = stream.getReader()
    expect(stream.locked).toBe(true)
    expect(() => stream.getReader()).toThrowError(TypeError)
    reader.releaseLock()
    expect(stream.locked).toBe(false)
    expect(() => stream.getReader()).not.toThrow()
  })

  it('拼接:多段 enqueue + 流式 decode 组成完整文本', async () => {
    const stream = new MinimalReadableStream({
      start(c) {
        for (const part of ['小', '程', '序']) c.enqueue(new TextEncoder().encode(part))
        c.close()
      },
    })
    expect(await textOf(stream)).toBe('小程序')
  })

  it('cancel 关闭流:挂起读落定 done', async () => {
    const stream = new MinimalReadableStream({
      start() {},
    })
    const reader = stream.getReader()
    const pending = reader.read()
    await reader.cancel()
    await expect(pending).resolves.toEqual({ done: true })
  })

  // —— dist 层:默认安装的是最小流,主 bundle 不带 web-streams ——

  it('dist:installer 安装的 ReadableStream 是最小实现', async () => {
    const mod = (await import(pathToFileURL(resolve(pkgRoot, './dist/index.js')).href)) as Record<
      string,
      unknown
    >
    const installerMod = mod
    expect(installerMod['MinimalReadableStream']).toBeDefined()
    // 主 bundle 已由 exports 契约测试断言不含 web-streams-polyfill
  })

  it('dist:streams/full 子路径存在且引用 web-streams(按需开关)', async () => {
    expect(readFileSync(resolve(pkgRoot, './dist/streams-full.js'), 'utf8')).toContain(
      'web-streams-polyfill',
    )
  })
})

// —— E2E:fetch 流式走最小引擎(wx-mock) ——

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
  setReadableStreamClass(undefined as never)
})

describe('fetch 流式(最小引擎,E2E)', () => {
  it('enableChunked + 最小引擎:逐块到达', async () => {
    setReadableStreamClass(MinimalReadableStream as never)
    mock.handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.write('第一块')
      res.write('第二块')
      res.end()
    }
    const response = await fetch(`${mock.origin}/stream`, { mp: { enableChunked: true } })
    const reader = (
      response.body as unknown as {
        getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> }
      }
    ).getReader()
    let text = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text += new TextDecoder().decode(value, { stream: true })
    }
    expect(text).toBe('第一块第二块')
  })
})

describe('MinimalReadableStream(规范对齐,差分审计锁行为)', () => {
  it('start 抛错:同步冒出构造函数(与 Node 原生一致)', () => {
    expect(
      () =>
        new MinimalReadableStream({
          start() {
            throw new Error('bad start')
          },
        }),
    ).toThrowError('bad start')
  })

  it('cancel 后 reader 不释放锁:仍可 read 落定 done(与原生一致)', async () => {
    const stream = new MinimalReadableStream({ start() {} })
    const reader = stream.getReader()
    const pending = reader.read()
    await reader.cancel()
    await expect(pending).resolves.toEqual({ done: true })
    await expect(reader.read()).resolves.toEqual({ done: true })
    expect(stream.locked).toBe(true)
  })
})
