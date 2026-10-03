/** 标准 URLSearchParams 实例面(与 DOM 类型对齐;不依赖 DOM lib)。 */
export interface URLSearchParamsInstance {
  /** 规约新增成员;引擎版本较旧时可能缺失(可选)。 */
  readonly size?: number
  append(name: string, value: string): void
  delete(name: string, value?: string): void
  get(name: string): string | null
  getAll(name: string): string[]
  has(name: string, value?: string): boolean
  set(name: string, value: string): void
  sort(): void
  forEach(callback: (value: string, key: string, parent: unknown) => void, thisArg?: unknown): void
  entries(): IterableIterator<[string, string]>
  keys(): IterableIterator<string>
  values(): IterableIterator<string>
  [Symbol.iterator](): IterableIterator<[string, string]>
  toString(): string
}

export type URLSearchParamsInit =
  string | Record<string, string | ReadonlyArray<string>> | Iterable<[string, string]>
