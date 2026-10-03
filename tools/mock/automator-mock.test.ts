import { describe, expect, it, vi } from 'vitest'
import { requestInterceptor } from './automator-mock.mjs'

/**
 * 序列化契约回归(DevTools 内置 App.mockWxMethod 实测语义,2026-10-03):
 *   fn.apply({ origin }, [options, ...mockWxMethod 尾参])
 *   结果通路是「返回值替换」:
 *   - 返回 {statusCode,data,header} → 调用方 success(该对象)
 *   - 返回 {errMsg} → 调用方 fail
 *   - 返回 Promise → resolve 值生效(延迟罐头/放行代理都靠它)
 *   - 返回 undefined → 调用方死等(实现里任何路径都不得出现)
 * fn 经 fn.toString() 序列化进 AppService,自由变量在那里不存在——
 * 先用 new Function 复刻「脱作用域求值」,任何自由变量都会 ReferenceError 暴露。
 */
const deserialized = new Function(
  `return (${requestInterceptor.toString()})`,
)() as typeof requestInterceptor

const routes = [
  { urlPrefix: 'http://pb.test/api/notes', statusCode: 201, body: { items: [] } },
  { urlRegExp: 'auth-with-password$', statusCode: 200, body: { token: 'jwt' } },
  { urlRegExp: 'explode$', fail: true, errMsg: 'request:fail canned' },
]

interface WxRequestOptionsForTest {
  url: string
  success?: (r: unknown) => void
  fail?: (e: unknown) => void
}

function callAsSetMockDoes(options: WxRequestOptionsForTest, origin?: (o: unknown) => unknown) {
  return deserialized.apply({ origin: origin ?? (() => {}) }, [options, routes, 0])
}

describe('automator-mock requestInterceptor(setMock 调用 + 返回值替换语义)', () => {
  it('urlPrefix 命中:返回罐头对象(statusCode/data/header)', () => {
    const result = callAsSetMockDoes({ url: 'http://pb.test/api/notes?page=1' }) as Record<
      string,
      unknown
    >
    expect(result).toEqual({
      statusCode: 201,
      data: JSON.stringify({ items: [] }),
      header: { 'content-type': 'application/json' },
    })
  })

  it('urlRegExp 命中:正则路由返回罐头', () => {
    const result = callAsSetMockDoes({
      url: 'http://pb.test/api/collections/users/auth-with-password',
    }) as Record<string, unknown>
    expect(result).toMatchObject({ statusCode: 200, data: JSON.stringify({ token: 'jwt' }) })
  })

  it('fail 路由:返回 errMsg 形状(触发调用方 fail)', () => {
    const result = callAsSetMockDoes({ url: 'http://pb.test/explode' }) as Record<string, unknown>
    expect(result).toEqual({ errMsg: 'request:fail canned' })
  })

  it('未命中:返回 Promise,代理 this.origin 的真实 success 结果', async () => {
    const origin = (o: { success?: (r: unknown) => void }) => {
      o.success?.({ statusCode: 200, data: '{"real":true}', header: {} })
    }
    const result = callAsSetMockDoes({ url: 'http://other.test/real' }, origin)
    expect(result).toBeInstanceOf(Promise)
    await expect(result).resolves.toEqual({ statusCode: 200, data: '{"real":true}', header: {} })
  })

  it('未命中且真请求失败:Promise resolve errMsg 形状(代理 fail)', async () => {
    const origin = (o: { fail?: (e: unknown) => void }) => {
      o.fail?.({ errMsg: 'request:fail timeout' })
    }
    const result = callAsSetMockDoes({ url: 'http://other.test/dead' }, origin)
    await expect(result).resolves.toEqual({ errMsg: 'request:fail timeout' })
  })

  it('delay > 0:返回延迟 resolve 的 Promise(假时钟驱动)', async () => {
    vi.useFakeTimers()
    try {
      const promise = deserialized.apply({ origin: () => {} }, [
        { url: 'http://pb.test/api/notes' },
        routes,
        20,
      ]) as Promise<Record<string, unknown>>
      const inspected = expect(promise).resolves.toMatchObject({ statusCode: 201 })
      vi.advanceTimersByTime(20)
      await inspected
    } finally {
      vi.useRealTimers()
    }
  })
})
