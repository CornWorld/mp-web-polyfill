import { getWx } from '../core'

export class QuotaExceededError extends Error {
  override name = 'QuotaExceededError'

  constructor(message = 'Exceeded storage quota.') {
    super(message)
  }
}

/** 与 wx storage 的键隔离:索引键记录本 API 管理的 key,clear() 只清理自己写入的键 */
const INDEX_KEY = '__cornworld_ls_index__'

/**
 * DOM Storage 语义的 localStorage,底层桥接 wx.setStorageSync。
 * 与浏览器 localStorage 的语义差异(无法抹平,显式声明):
 * 1. 单 key 上限 1MB、总量上限 10MB(超限抛 QuotaExceededError);
 * 2. 无 storage 事件(小程序无跨标签页概念);
 * 3. 宿主可能回收存储(官方允许系统清理);
 * 4. 仅支持字符串值(非字符串会按 String(v) 序列化)。
 */
export class MPLocalStorage {
  #getIndex(): string[] {
    const wx = getWx()
    if (!wx) return []
    const raw = wx.getStorageSync(INDEX_KEY)
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []
  }

  #setIndex(keys: string[]): void {
    getWx()?.setStorageSync(INDEX_KEY, keys)
  }

  get length(): number {
    return this.#getIndex().length
  }

  key(index: number): string | null {
    return this.#getIndex()[index] ?? null
  }

  getItem(key: string): string | null {
    const wx = getWx()
    if (!wx) return null
    const normalized = String(key)
    if (!this.#getIndex().includes(normalized)) return null
    const value = wx.getStorageSync(normalized)
    return typeof value === 'string' ? value : String(value)
  }

  setItem(key: string, value: string): void {
    const wx = getWx()
    if (!wx) throw new Error('localStorage: 未找到 wx 宿主全局对象')
    const normalized = String(key)
    const normalizedValue = String(value)
    try {
      wx.setStorageSync(normalized, normalizedValue)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new QuotaExceededError(`localStorage.setItem failed: ${message}`)
    }
    const keys = this.#getIndex()
    if (!keys.includes(normalized)) {
      keys.push(normalized)
      this.#setIndex(keys)
    }
  }

  removeItem(key: string): void {
    const wx = getWx()
    if (!wx) return
    const normalized = String(key)
    wx.removeStorageSync(normalized)
    this.#setIndex(this.#getIndex().filter((k) => k !== normalized))
  }

  /** 只清理经本 API 写入的键,不影响宿主其他 wx storage 数据 */
  clear(): void {
    const wx = getWx()
    if (!wx) return
    for (const key of this.#getIndex()) wx.removeStorageSync(key)
    this.#setIndex([])
  }

  toString(): string {
    return '[object Storage]'
  }
}

export const localStorage = new MPLocalStorage()
