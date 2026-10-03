export type HeadersInit =
  | Headers
  | Record<string, string>
  | Iterable<[string, string]>
  | readonly (readonly [string, string])[]

function normalizeName(name: string): string {
  const lowered = String(name).trim().toLowerCase()
  if (lowered === '') throw new TypeError('Header name must not be empty')
  return lowered
}

function normalizeValue(value: string): string {
  return String(value).trim()
}

/**
 * WHATWG Headers 子集:大小写不敏感、append 多值合并、
 * 迭代按键名排序(与规范一致)。
 */
export class Headers {
  #map = new Map<string, string[]>()

  constructor(init?: HeadersInit) {
    if (init) {
      if (init instanceof Headers) {
        for (const [name, value] of init.entries()) this.append(name, value)
      } else if (Array.isArray(init) || Symbol.iterator in Object(init)) {
        for (const [name, value] of init as Iterable<[string, string]>) {
          this.append(name, value)
        }
      } else {
        for (const [name, value] of Object.entries(init as Record<string, string>)) {
          this.append(name, value)
        }
      }
    }
  }

  append(name: string, value: string): void {
    const key = normalizeName(name)
    const current = this.#map.get(key)
    if (current) current.push(normalizeValue(value))
    else this.#map.set(key, [normalizeValue(value)])
  }

  set(name: string, value: string): void {
    this.#map.set(normalizeName(name), [normalizeValue(value)])
  }

  has(name: string): boolean {
    return this.#map.has(normalizeName(name))
  }

  get(name: string): string | null {
    const values = this.#map.get(normalizeName(name))
    return values ? values.join(', ') : null
  }

  delete(name: string): void {
    this.#map.delete(normalizeName(name))
  }

  forEach(cb: (value: string, name: string, parent: Headers) => void, thisArg?: unknown): void {
    for (const [name, value] of this.entries()) {
      cb.call(thisArg, value, name, this)
    }
  }

  *entries(): IterableIterator<[string, string]> {
    for (const key of [...this.#map.keys()].sort()) {
      yield [key, this.#map.get(key)!.join(', ')]
    }
  }

  *keys(): IterableIterator<string> {
    yield* [...this.#map.keys()].sort()
  }

  *values(): IterableIterator<string> {
    for (const [, value] of this.entries()) yield value
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries()
  }
}

export function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of headers.entries()) out[name] = value
  return out
}
