import * as fetchPkg from '../fetch'
import { setReadableStreamClass } from '../fetch'
import { MinimalReadableStream } from '../fetch/minimal-streams'
import { TextDecoder, TextEncoder } from '../text-encoding'
import { URL, URLSearchParams } from '../url'
import { EventSource } from '../eventsource'
import { localStorage } from '../storage'

export const POLYFILL_MARKER = Symbol.for('cornworld.mp-polyfill')

// 版本取自构建期注入(tsup define,源码层单测回退 dev 值),避免与包版本脱钩
const POLYFILL_META = {
  pkg: 'mp-web-polyfill',
  version: typeof __PKG_VERSION__ === 'string' ? __PKG_VERSION__ : '0.0.0-dev',
}

export type RuntimeTarget =
  | 'fetch'
  | 'Headers'
  | 'Request'
  | 'Response'
  | 'AbortController'
  | 'AbortSignal'
  | 'Blob'
  | 'File'
  | 'FormData'
  | 'TextEncoder'
  | 'TextDecoder'
  | 'URL'
  | 'URLSearchParams'
  | 'EventSource'
  | 'localStorage'
  | 'ReadableStream'

const PROVIDERS: Record<RuntimeTarget, () => unknown> = {
  fetch: () => fetchPkg.fetch,
  Headers: () => fetchPkg.Headers,
  Request: () => fetchPkg.Request,
  Response: () => fetchPkg.Response,
  AbortController: () => fetchPkg.AbortController,
  AbortSignal: () => fetchPkg.AbortSignal,
  Blob: () => fetchPkg.Blob,
  File: () => fetchPkg.File,
  FormData: () => fetchPkg.FormData,
  TextEncoder: () => TextEncoder,
  TextDecoder: () => TextDecoder,
  URL: () => URL,
  URLSearchParams: () => URLSearchParams,
  EventSource: () => EventSource,
  localStorage: () => localStorage,
  // 最小流实现(仅 reader 消费面):完整 Streams 规范按需经 ./streams/full
  ReadableStream: () => MinimalReadableStream,
}

export type GlobalSource = 'ours' | 'host' | 'absent'

export interface InstallOptions {
  /** API 级粒度:默认全部安装 */
  targets?: RuntimeTarget[]
  /** 为 true 时覆盖宿主/他库已有实现(默认跳过,冲突安全) */
  force?: boolean
}

export interface InstallReport {
  installed: string[]
  skipped: string[]
  replaced: string[]
}

function sourceOf(value: unknown): GlobalSource {
  if (value === undefined || value === null) return 'absent'
  return (value as Record<symbol, unknown>)[POLYFILL_MARKER] !== undefined ? 'ours' : 'host'
}

function markAsOurs(value: unknown): void {
  try {
    Object.defineProperty(value, POLYFILL_MARKER, {
      value: POLYFILL_META,
      enumerable: false,
      configurable: true,
    })
  } catch {
    // 冻结对象打不上标记也不影响安装
  }
}

/**
 * 一站式安装器:
 * - 默认只补缺失的 API,宿主原生实现与第三方 polyfill(如 @wevu/web-apis)一律不覆盖;
 * - force: true 时显式接管(replaced 上报);
 * - 本家族重复安装幂等(skipped 上报);
 * - 安装 ReadableStream 后自动接到 fetch 的流式通道。
 */
export function installWebRuntimeGlobals(options: InstallOptions = {}): InstallReport {
  const targets = [...new Set(options.targets ?? (Object.keys(PROVIDERS) as RuntimeTarget[]))]
  const report: InstallReport = { installed: [], skipped: [], replaced: [] }
  const globals = globalThis as unknown as Record<string, unknown>

  for (const target of targets) {
    const value = PROVIDERS[target]()
    const source = sourceOf(globals[target])
    if (source === 'ours') {
      report.skipped.push(target)
      continue
    }
    if (source === 'host' && !options.force) {
      report.skipped.push(target)
      continue
    }
    if (source === 'host') report.replaced.push(target)
    else report.installed.push(target)
    markAsOurs(value)
    globals[target] = value
  }

  // 流式通道接线:无论 ReadableStream 是我们装的还是宿主/第三方提供的
  // (后者常见于 fetch 模块先装载、宿主流实现后出现的时序),只要存在就接通
  const readableStream = globals.ReadableStream
  if (readableStream !== undefined && readableStream !== null) {
    setReadableStreamClass(readableStream as Parameters<typeof setReadableStreamClass>[0])
  }
  return report
}

export function listGlobalsStatus(): { name: RuntimeTarget; source: GlobalSource }[] {
  const globals = globalThis as unknown as Record<string, unknown>
  return (Object.keys(PROVIDERS) as RuntimeTarget[]).map((name) => ({
    name,
    source: sourceOf(globals[name]),
  }))
}

export const ALL_TARGETS = Object.keys(PROVIDERS) as RuntimeTarget[]
