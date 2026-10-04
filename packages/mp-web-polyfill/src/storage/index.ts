import { getWx } from '../core'

export class QuotaExceededError extends Error {
  override name = 'QuotaExceededError'

  // 不用 ES2022 的 ErrorOptions:发出的 d.ts 不强求消费方 lib 升级
  constructor(message = 'Exceeded storage quota.', options?: { cause?: unknown }) {
    super(message)
    if (options && 'cause' in options) {
      ;(this as { cause?: unknown }).cause = options.cause
    }
  }
}

/** 与 wx storage 的键隔离:索引键记录本 API 管理的 key,clear() 只清理自己写入的键 */
const INDEX_KEY = '__cornworld_ls_index__'

/**
 * DOM Storage 语义的 localStorage, 底层桥接 wx.setStorageSync。
 * 与浏览器 localStorage 的语义差异无法抹平, 显式声明如下。
 * 1. 单 key 上限 1MB、总量上限 10MB(超限抛 QuotaExceededError)
 * 2. 无 storage 事件(小程序无跨标签页概念)
 * 3. 宿主可能回收存储(官方允许系统清理)
 * 4. 仅支持字符串值(非字符串会按 String(v) 序列化)
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
    // 先登记索引再写值, 值写入失败时回滚索引, 避免"值已死、索引还在"的孤儿态
    // (索引指向缺失键, getItem 的索引门会永远返回 null)
    const keys = this.#getIndex()
    const isNew = !keys.includes(normalized)
    if (isNew) {
      keys.push(normalized)
      this.#setIndex(keys)
    }
    try {
      wx.setStorageSync(normalized, normalizedValue)
    } catch (err) {
      if (isNew) this.#setIndex(this.#getIndex().filter((k) => k !== normalized))
      const message = err instanceof Error ? err.message : String(err)
      // 真机配额 errMsg 形如 "setStorageSync:fail exceed storage max size 10240Kb",
      // 其余(非法 key / 存储被禁用等)不伪装成配额错误
      if (/exceed|quota/i.test(message)) {
        throw new QuotaExceededError(`localStorage.setItem failed: ${message}`, { cause: err })
      }
      // Error 两参构造需 ES2022 lib:手动挂 cause,保持 d.ts 对消费方 lib 无要求
      const failure = new Error(`localStorage.setItem failed: ${message}`)
      ;(failure as { cause?: unknown }).cause = err
      throw failure
    }
  }

  removeItem(key: string): void {
    const wx = getWx()
    if (!wx) return
    const normalized = String(key)
    // 隔离契约: 只删本 API 管理的键。索引外(宿主自有数据)视为不存在,
    // no-op, 与浏览器 removeItem 对缺失键的语义一致, 且防止误删宿主数据
    if (!this.#getIndex().includes(normalized)) return
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
