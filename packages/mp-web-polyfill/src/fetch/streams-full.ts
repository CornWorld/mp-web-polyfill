import { ReadableStream } from 'web-streams-polyfill'
import { setReadableStreamClass } from './streams'

/**
 * 完整 WHATWG Streams 引擎(web-streams-polyfill)的按需开关:
 * import 本模块即注入(幂等)。默认引擎是内置最小实现(仅 reader 消费面,
 * 见 ./minimal-streams);需要 tee / pipeTo / 背压等完整规范面时才装本模块 ——
 * 独立 bundle,web-streams 的 ~62KB 只随显式 import 的消费方携带。
 */
export function installFullReadableStreams(): void {
  setReadableStreamClass(ReadableStream as never)
}

// import 即安装(幂等)
installFullReadableStreams()
