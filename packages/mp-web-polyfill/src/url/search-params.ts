// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- ambient 深路径模块声明只能经三斜线引用拉进 program(消费方按 src 编译时也生效)
/// <reference path="./engine.d.ts" />

import { parseUrlencodedString, serializeUrlencoded } from 'whatwg-url/lib/urlencoded.js'
import type { URLRecord } from './engine-types'

import type { URLSearchParamsInit, URLSearchParamsInstance } from './types'

/**
 * URLSearchParams(引擎:whatwg-url 的 urlencoded 纯函数,与 Node 同源)。
 *
 * whatwg-url 自带的 URLSearchParams 类是 webidl2js 运行时生成的(需要
 * eval),小程序逻辑层没有 eval;改为直接包装 urlencoded parse/serialize
 * 纯函数,行为与其 URLSearchParamsImpl 一致。
 *
 * 绑定语义:通过 bindURLSearchParams() 与某个 URLRecord 关联后,任何变更
 * 都把序列化结果写回 record.query(write-through),镜像规约的 update steps。
 */
const boundRecord = Symbol('urlRecordBinding')

export class URLSearchParams {
  [boundRecord]: URLRecord | null = null
  #list: [string, string][] = []

  constructor(init?: URLSearchParamsInit) {
    if (init === undefined || init === null) {
      return
    }
    if (typeof init === 'string') {
      const input = init[0] === '?' ? init.slice(1) : init
      this.#list = parseUrlencodedString(input)
      return
    }
    if (typeof (init as Iterable<[string, string]>)[Symbol.iterator] === 'function') {
      for (const pair of init as Iterable<[string, string]>) {
        if (!Array.isArray(pair) || pair.length !== 2) {
          throw new TypeError(
            "Failed to construct 'URLSearchParams': parameter 1 sequence's element does not contain exactly two elements.",
          )
        }
        this.#list.push([String(pair[0]), String(pair[1])])
      }
      return
    }
    const record = init as Record<string, string | ReadonlyArray<string>>
    for (const name of Object.keys(record)) {
      const value = record[name]
      if (Array.isArray(value)) {
        for (const item of value) this.#list.push([name, String(item)])
      } else {
        this.#list.push([name, String(value)])
      }
    }
  }

  /** URL 层变更 query 后,重置 list 为最新 query 的解析结果(绑定 seam)。 */
  resyncFromQuery(query: string | null): void {
    this.#list = query === null ? [] : parseUrlencodedString(query)
  }

  get size(): number {
    return this.#list.length
  }

  append(name: string, value: string): void {
    this.#list.push([name, value])
    this.#updateSteps()
  }

  delete(name: string, value?: string): void {
    let i = 0
    while (i < this.#list.length) {
      const tuple = this.#list[i]
      if (tuple !== undefined && tuple[0] === name && (value === undefined || tuple[1] === value)) {
        this.#list.splice(i, 1)
      } else {
        i++
      }
    }
    this.#updateSteps()
  }

  get(name: string): string | null {
    for (const tuple of this.#list) {
      if (tuple[0] === name) return tuple[1]
    }
    return null
  }

  getAll(name: string): string[] {
    const output: string[] = []
    for (const tuple of this.#list) {
      if (tuple[0] === name) output.push(tuple[1])
    }
    return output
  }

  has(name: string, value?: string): boolean {
    for (const tuple of this.#list) {
      if (tuple[0] === name && (value === undefined || tuple[1] === value)) return true
    }
    return false
  }

  set(name: string, value: string): void {
    let found = false
    let i = 0
    while (i < this.#list.length) {
      const tuple = this.#list[i]
      if (tuple === undefined || tuple[0] !== name) {
        i++
      } else if (found) {
        this.#list.splice(i, 1)
      } else {
        found = true
        tuple[1] = value
        i++
      }
    }
    if (!found) {
      this.#list.push([name, value])
    }
    this.#updateSteps()
  }

  sort(): void {
    // 规约:按 code unit 顺序排键,稳定排序
    this.#list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    this.#updateSteps()
  }

  toString(): string {
    return serializeUrlencoded(this.#list)
  }

  forEach(
    callback: (value: string, key: string, parent: unknown) => void,
    thisArg?: unknown,
  ): void {
    for (const [key, value] of [...this.#list]) {
      callback.call(thisArg, value, key, this)
    }
  }

  *entries(): IterableIterator<[string, string]> {
    yield* [...this.#list]
  }

  *keys(): IterableIterator<string> {
    for (const [key] of this.#list) yield key
  }

  *values(): IterableIterator<string> {
    for (const [, value] of this.#list) yield value
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries()
  }

  /** 规约 update steps:绑定态下把序列化结果写回 url.query。 */
  #updateSteps(): void {
    const record = this[boundRecord]
    if (record === null) return
    const serialized = serializeUrlencoded(this.#list)
    record.query = serialized === '' ? null : serialized
  }
}

/**
 * URL.searchParams 的绑定工厂(模块内 seam,不进公共 API):
 * 初始 list 来自 record.query,后续变更写穿透回 record.query。
 */
export function bindURLSearchParams(record: URLRecord): URLSearchParams {
  const searchParams = new URLSearchParams(record.query ?? '')
  searchParams[boundRecord] = record
  return searchParams
}

export type { URLSearchParamsInstance }
