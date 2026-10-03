// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- ambient 深路径模块声明只能经三斜线引用拉进 program(消费方按 src 编译时也生效)
/// <reference path="./engine.d.ts" />

import {
  basicURLParse,
  cannotHaveAUsernamePasswordPort,
  hasAnOpaquePath,
  serializeHost,
  serializeInteger,
  serializePath,
  serializeURL,
  serializeURLOrigin,
  setThePassword,
  setTheUsername,
} from 'whatwg-url/lib/url-state-machine.js'
import type { URLRecord } from './engine-types'

import { bindURLSearchParams } from './search-params'
import type { URLSearchParams } from './search-params'

export { URLSearchParams } from './search-params'

/**
 * WHATWG URL 包装(引擎:whatwg-url 的 url-state-machine 纯状态机,
 * jsdom/Node 同源实现,WPT 一致性)。
 *
 * 刻意不走 whatwg-url 主入口的 URL/URLSearchParams 包装类:那一层由
 * webidl2js 在运行时生成(需要 eval),小程序逻辑层没有 eval;且经消费方
 * 打包器(rolldown/weapp-vite)chunk 化后,初始化失败会被 __commonJSMin
 * 缓存成永久性不完整 exports。状态机 + urlencoded 纯函数无此问题。
 * 行为镜像 whatwg-url 自带 URLImpl(WPT 同源语义)。
 */
export class URL {
  #record: URLRecord
  #searchParams: URLSearchParams | null = null

  constructor(url: string | URL, base?: string | URL) {
    const input = url instanceof URL ? url.href : url
    // 显式传入的 undefined/null base 按参数缺省处理(与旧包装一致)
    let parsedBase: URLRecord | null = null
    if (base !== undefined && base !== null) {
      parsedBase = basicURLParse(base instanceof URL ? base.href : base)
      if (parsedBase === null) throw new TypeError(`Invalid base URL: ${base}`)
    }
    const parsed = basicURLParse(input, { baseURL: parsedBase })
    if (parsed === null) throw new TypeError(`Invalid URL: ${input}`)
    this.#record = parsed
  }

  static canParse(url: string, base?: string): boolean {
    let parsedBase: URLRecord | null = null
    if (base !== undefined) {
      parsedBase = basicURLParse(base)
      if (parsedBase === null) return false
    }
    return basicURLParse(url, { baseURL: parsedBase }) !== null
  }

  static parse(url: string, base?: string): URL | null {
    try {
      return new URL(url, base)
    } catch {
      return null
    }
  }

  get href(): string {
    return serializeURL(this.#record)
  }

  set href(value: string) {
    const parsed = basicURLParse(value)
    if (parsed === null) throw new TypeError(`Invalid URL: ${value}`)
    this.#record = parsed
    this.#resyncSearchParams()
  }

  get origin(): string {
    return serializeURLOrigin(this.#record)
  }

  get protocol(): string {
    return `${this.#record.scheme}:`
  }

  set protocol(value: string) {
    basicURLParse(`${value}:`, { url: this.#record, stateOverride: 'scheme start' })
  }

  get username(): string {
    return this.#record.username
  }

  set username(value: string) {
    if (cannotHaveAUsernamePasswordPort(this.#record)) return
    setTheUsername(this.#record, value)
  }

  get password(): string {
    return this.#record.password
  }

  set password(value: string) {
    if (cannotHaveAUsernamePasswordPort(this.#record)) return
    setThePassword(this.#record, value)
  }

  get host(): string {
    const { host, port } = this.#record
    if (host === null) return ''
    if (port === null) return serializeHost(host)
    return `${serializeHost(host)}:${serializeInteger(port)}`
  }

  set host(value: string) {
    if (hasAnOpaquePath(this.#record)) return
    basicURLParse(value, { url: this.#record, stateOverride: 'host' })
  }

  get hostname(): string {
    const { host } = this.#record
    return host === null ? '' : serializeHost(host)
  }

  set hostname(value: string) {
    if (hasAnOpaquePath(this.#record)) return
    basicURLParse(value, { url: this.#record, stateOverride: 'hostname' })
  }

  get port(): string {
    const { port } = this.#record
    return port === null ? '' : serializeInteger(port)
  }

  set port(value: string) {
    if (cannotHaveAUsernamePasswordPort(this.#record)) return
    if (value === '') {
      this.#record.port = null
    } else {
      basicURLParse(value, { url: this.#record, stateOverride: 'port' })
    }
  }

  get pathname(): string {
    return serializePath(this.#record)
  }

  set pathname(value: string) {
    if (hasAnOpaquePath(this.#record)) return
    this.#record.path = []
    basicURLParse(value, { url: this.#record, stateOverride: 'path start' })
  }

  get search(): string {
    const query = this.#record.query
    return query === null || query === '' ? '' : `?${query}`
  }

  set search(value: string) {
    if (value === '') {
      this.#record.query = null
      this.#resyncSearchParams()
      return
    }
    const input = value[0] === '?' ? value.substring(1) : value
    this.#record.query = ''
    basicURLParse(input, { url: this.#record, stateOverride: 'query' })
    this.#resyncSearchParams()
  }

  get searchParams(): URLSearchParams {
    if (this.#searchParams === null) {
      this.#searchParams = bindURLSearchParams(this.#record)
    }
    return this.#searchParams
  }

  get hash(): string {
    const fragment = this.#record.fragment
    return fragment === null || fragment === '' ? '' : `#${fragment}`
  }

  set hash(value: string) {
    if (value === '') {
      this.#record.fragment = null
      return
    }
    const input = value[0] === '#' ? value.substring(1) : value
    this.#record.fragment = ''
    basicURLParse(input, { url: this.#record, stateOverride: 'fragment' })
  }

  toString(): string {
    return this.href
  }

  toJSON(): string {
    return this.href
  }

  /** URL 层变更 query 后,重同步已创建的 searchParams 镜像。 */
  #resyncSearchParams(): void {
    this.#searchParams?.resyncFromQuery(this.#record.query)
  }
}
