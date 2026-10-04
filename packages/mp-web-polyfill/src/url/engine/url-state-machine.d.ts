// Vendored url-state-machine 的类型面:仅覆盖本仓库消费的导出。
// 类型形状与 src/url/engine-types.ts 的 URLRecord 对齐(whatwg-url v14)。
import type { URLRecord } from '../engine-types'

export type URLParseOptions = {
  baseURL?: URLRecord | null
  url?: URLRecord
  stateOverride?: string
  encodingOverride?: string
}

export function basicURLParse(input: string, options?: URLParseOptions): URLRecord | null
export function serializeURL(url: URLRecord, excludeFragment?: boolean): string
export function serializeURLOrigin(url: URLRecord): string
export function serializeHost(host: URLRecord['host']): string
export function serializePath(url: URLRecord): string
export function serializeInteger(integer: number): string
export function cannotHaveAUsernamePasswordPort(url: URLRecord): boolean
export function hasAnOpaquePath(url: URLRecord): boolean
export function setTheUsername(url: URLRecord, username: string): void
export function setThePassword(url: URLRecord, password: string): void
