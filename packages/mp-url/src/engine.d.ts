/**
 * whatwg-url 纯模块的深路径类型声明。
 *
 * 只引入 lib/url-state-machine 与 lib/urlencoded(经 grep 验证:零 eval /
 * new Function / ctorRegistry 引用);主入口 index.js 的 webidl2js 包装层
 * 在运行时用 eval 生成包装类,小程序逻辑层没有 eval,不可用(实测 2026-10-03)。
 */

declare module 'whatwg-url/lib/url-state-machine.js' {
  import type { URLRecord } from './engine-types'

  export function parseURL(
    input: string,
    options?: { baseURL?: URLRecord | null; encodingOverride?: string },
  ): URLRecord | null

  export function basicURLParse(
    input: string,
    options?: {
      baseURL?: URLRecord | null
      url?: URLRecord
      stateOverride?: string
      encodingOverride?: string
    },
  ): URLRecord | null

  export function serializeURL(url: URLRecord, excludeFragment?: boolean): string
  export function serializePath(url: URLRecord): string
  export function serializeURLOrigin(url: URLRecord): string
  export function serializeHost(host: URLRecord['host']): string
  export function serializeInteger(integer: number | string): string
  export function setTheUsername(url: URLRecord, username: string): void
  export function setThePassword(url: URLRecord, password: string): void
  export function cannotHaveAUsernamePasswordPort(url: URLRecord): boolean
  export function hasAnOpaquePath(url: URLRecord): boolean
}

declare module 'whatwg-url/lib/urlencoded.js' {
  export function parseUrlencodedString(input: string): [string, string][]
  export function serializeUrlencoded(tuples: [string, string][]): string
}
