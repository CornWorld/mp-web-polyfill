function encodeCodePoint(cp: number, out: number[]): void {
  if (cp <= 0x7f) {
    out.push(cp)
  } else if (cp <= 0x7ff) {
    out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
  } else if (cp <= 0xffff) {
    out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
  } else {
    out.push(
      0xf0 | (cp >> 18),
      0x80 | ((cp >> 12) & 0x3f),
      0x80 | ((cp >> 6) & 0x3f),
      0x80 | (cp & 0x3f),
    )
  }
}

/** WHATWG utf-8 encode:独立代理项编码为 U+FFFD,而非抛错。 */
export function utf8Encode(input: string): Uint8Array {
  const out: number[] = []
  let i = 0
  while (i < input.length) {
    const code = input.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const low = input.charCodeAt(i + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        encodeCodePoint((code - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000, out)
        i += 2
        continue
      }
    }
    encodeCodePoint(code >= 0xd800 && code <= 0xdfff ? 0xfffd : code, out)
    i += 1
  }
  return Uint8Array.from(out)
}

export class TextEncoder {
  readonly encoding = 'utf-8'

  encode(input = ''): Uint8Array {
    return utf8Encode(String(input))
  }

  encodeInto(source: string, destination: Uint8Array): { read: number; written: number } {
    let read = 0
    let written = 0
    let i = 0
    while (i < source.length) {
      const code = source.charCodeAt(i)
      let cp: number
      let consumed: number
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < source.length) {
        const low = source.charCodeAt(i + 1)
        if (low >= 0xdc00 && low <= 0xdfff) {
          cp = (code - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000
          consumed = 2
        } else {
          cp = 0xfffd
          consumed = 1
        }
      } else if (code >= 0xd800 && code <= 0xdfff) {
        cp = 0xfffd
        consumed = 1
      } else {
        cp = code
        consumed = 1
      }

      const needed = cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4
      if (written + needed > destination.length) break

      const tmp: number[] = []
      encodeCodePoint(cp, tmp)
      for (const byte of tmp) destination[written++] = byte
      read += consumed
      i += consumed
    }
    return { read, written }
  }
}
