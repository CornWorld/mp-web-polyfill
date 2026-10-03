import * as fetchPkg from '@cornworld/mp-fetch'
import { setReadableStreamClass } from '@cornworld/mp-fetch'
import { TextDecoder, TextEncoder } from '@cornworld/mp-text-encoding'
import { URL, URLSearchParams } from '@cornworld/mp-url'
import { EventSource } from '@cornworld/mp-eventsource'
import { localStorage } from '@cornworld/mp-storage'
import { ReadableStream } from 'web-streams-polyfill'

export const POLYFILL_MARKER = Symbol.for('cornworld.mp-polyfill')

const POLYFILL_META = { pkg: '@cornworld/mp-web-runtime', version: '0.1.0' }

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
  ReadableStream: () => ReadableStream,
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
  const targets = options.targets ?? (Object.keys(PROVIDERS) as RuntimeTarget[])
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

  if (sourceOf(globals.ReadableStream) === 'ours') {
    setReadableStreamClass(globals.ReadableStream as Parameters<typeof setReadableStreamClass>[0])
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
