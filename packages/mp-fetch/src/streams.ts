export interface PushStreamHandle {
  stream: unknown
  push(chunk: Uint8Array): void
  close(): void
  error(err: unknown): void
}

type ReadableStreamClass = new (underlyingSource: {
  start: (controller: RSController) => void
}) => unknown

interface RSController {
  enqueue(chunk: Uint8Array): void
  close(): void
  error(err: unknown): void
}

let readableStreamClass: ReadableStreamClass | undefined = (globalThis as { ReadableStream?: ReadableStreamClass })
  .ReadableStream

/**
 * 注入 ReadableStream 实现(推荐 web-streams-polyfill)。
 * 未注入且宿主无原生实现时,chunked 响应会退化为缓冲模式。
 */
export function setReadableStreamClass(cls: ReadableStreamClass): void {
  readableStreamClass = cls
}

export function getReadableStreamClass(): ReadableStreamClass | undefined {
  return readableStreamClass
}

export function isStreamingSupported(): boolean {
  return readableStreamClass !== undefined
}

/** 创建“推送式”ReadableStream(onChunkReceived 回调 → enqueue)。 */
export function createPushStream(): PushStreamHandle | null {
  const RS = readableStreamClass
  if (!RS) return null
  let controller!: RSController
  const stream = new RS({
    start(c) {
      controller = c
    },
  })
  return {
    stream,
    push: (chunk) => controller.enqueue(chunk),
    close: () => controller.close(),
    error: (err) => controller.error(err),
  }
}
