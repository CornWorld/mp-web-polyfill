/**
 * 小程序逻辑层没有 DOMException,这里提供等价命名的 AbortError。
 */
export class MPAbortError extends Error {
  override name = 'AbortError'

  constructor(message = 'The operation was aborted.') {
    super(message)
  }
}

export function createAbortError(message?: string): MPAbortError {
  return new MPAbortError(message)
}

export function isAbortError(value: unknown): value is MPAbortError {
  return value instanceof Error && value.name === 'AbortError'
}

/** 与 DOM 标准一致:signal 已中止时抛出 AbortError。 */
export function throwIfAborted(signal?: { aborted: boolean; reason?: unknown }): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : createAbortError()
  }
}
