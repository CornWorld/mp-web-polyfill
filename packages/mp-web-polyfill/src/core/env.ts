import type { WxLike } from './wx-types'

/**
 * 读取宿主全局的 wx 对象。
 * Skyline 与 WebView 两种渲染引擎共用同一逻辑层,wx 在两者下等价可用。
 */
export function getWx(): WxLike | undefined {
  return (globalThis as { wx?: WxLike }).wx
}

export function isMiniProgramRuntime(): boolean {
  const wx = getWx()
  return typeof wx?.request === 'function'
}

/** 非小程序环境(如 Node 里的单元测试)注入的替代宿主。 */
export function setWxForTesting(wx: WxLike | undefined): void {
  ;(globalThis as { wx?: WxLike }).wx = wx
}
