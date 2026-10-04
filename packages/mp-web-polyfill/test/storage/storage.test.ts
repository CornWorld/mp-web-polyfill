import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { startWxMock, type WxMock } from '@cornworld/wx-mock'
import { setWxForTesting } from '../../src/core'
import { localStorage, MPLocalStorage, QuotaExceededError } from '../../src/storage'

let mock: WxMock

beforeEach(async () => {
  mock = await startWxMock()
  setWxForTesting(mock.wx)
})

afterAll(async () => {
  setWxForTesting(undefined)
  await mock.close()
})

describe('localStorage(wx storage 桥)', () => {
  it('set/get 往返,非字符串按 String 序列化', () => {
    localStorage.setItem('token', 'abc123')
    localStorage.setItem('count', 42 as unknown as string)
    expect(localStorage.getItem('token')).toBe('abc123')
    expect(localStorage.getItem('count')).toBe('42')
  })

  it('不存在的键返回 null(wx 缺省返回空串,已被区分)', () => {
    expect(localStorage.getItem('missing')).toBeNull()
  })

  it('key(i) 与 length 按插入顺序', () => {
    localStorage.clear()
    localStorage.setItem('b', '2')
    localStorage.setItem('a', '1')
    expect(localStorage.length).toBe(2)
    expect(localStorage.key(0)).toBe('b')
    expect(localStorage.key(1)).toBe('a')
    expect(localStorage.key(9)).toBeNull()
  })

  it('removeItem 与 clear(只清自己的键)', () => {
    localStorage.clear()
    localStorage.setItem('x', '1')
    mock.wx.setStorageSync('native-key', '保留') // 宿主其他数据
    localStorage.removeItem('x')
    expect(localStorage.getItem('x')).toBeNull()
    localStorage.setItem('y', '2')
    localStorage.clear()
    expect(localStorage.length).toBe(0)
    expect(mock.wx.getStorageSync('native-key')).toBe('保留')
  })

  it('removeItem 对索引外的宿主键是 no-op(隔离契约)', () => {
    localStorage.clear()
    mock.wx.setStorageSync('native-key', '保留')
    localStorage.removeItem('native-key')
    expect(mock.wx.getStorageSync('native-key')).toBe('保留')
    // 索引键自身不可被删除,否则后续读写全部失联
    localStorage.removeItem('__cornworld_ls_index__')
    localStorage.setItem('a', '1')
    expect(localStorage.getItem('a')).toBe('1')
  })

  it('非配额错误不伪装成 QuotaExceededError', () => {
    setWxForTesting({
      getStorageSync: () => '',
      setStorageSync: () => {
        throw new Error('setStorageSync:fail 系统忙')
      },
      removeStorageSync: () => {},
    } as unknown as Parameters<typeof setWxForTesting>[0])
    let thrown: unknown
    try {
      localStorage.setItem('k', 'v')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).not.toBeInstanceOf(QuotaExceededError)
  })

  it('超配额抛 QuotaExceededError,且不污染索引', async () => {
    setWxForTesting(undefined)
    await mock.close()
    mock = await startWxMock({ maxTotalStorageBytes: 64 })
    setWxForTesting(mock.wx)
    expect(() => localStorage.setItem('big', 'x'.repeat(200))).toThrowError(QuotaExceededError)
    expect(localStorage.length).toBe(0)
    expect(localStorage.getItem('big')).toBeNull()
  })

  it('导出的 localStorage 与类实例行为一致', () => {
    expect(localStorage).toBeInstanceOf(MPLocalStorage)
  })
})
