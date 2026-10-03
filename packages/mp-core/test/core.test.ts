import { describe, expect, it } from 'vitest'
import { MPAbortError, concatBytes, isMiniProgramRuntime, throwIfAborted } from '@cornworld/mp-core'

describe('mp-core', () => {
  it('concatBytes 拼接多段字节', () => {
    const out = concatBytes([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([])])
    expect([...out]).toEqual([1, 2, 3])
  })

  it('throwIfAborted 抛出名为 AbortError 的错误', () => {
    expect(() => throwIfAborted({ aborted: true })).toThrowError(MPAbortError)
    try {
      throwIfAborted({ aborted: true })
    } catch (e) {
      expect((e as Error).name).toBe('AbortError')
    }
  })

  it('未注入 wx 时不是小程序运行时', () => {
    expect(isMiniProgramRuntime()).toBe(false)
  })
})
