import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TextDecoder, TextEncoder } from '@cornworld/mp-text-encoding'

interface Utf8Case {
  name: string
  str?: string
  bytes?: number[]
  expected?: string | null
  splits?: number[][]
  fatalThrows?: boolean
  options?: { ignoreBOM?: boolean; fatal?: boolean }
}

const cases: Utf8Case[] = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/utf8-cases.json', import.meta.url)), 'utf8'),
)

// fixture 来源:WHATWG Encoding 规范用例 + WPT encoding/utf-8 子集人工移植
describe('TextDecoder / TextEncoder(WPT 移植用例)', () => {
  for (const c of cases) {
    const expectedOut = c.expected !== undefined ? c.expected : c.str
    if (c.fatalThrows || (c.bytes && expectedOut !== undefined)) {
      it(`decode: ${c.name}`, () => {
        const decoder = new TextDecoder('utf-8', {
          fatal: c.fatalThrows || c.options?.fatal,
          ignoreBOM: c.options?.ignoreBOM,
        })
        const bytes = new Uint8Array(c.bytes ?? [])
        if (c.fatalThrows) {
          expect(() => decoder.decode(bytes)).toThrowError(TypeError)
          return
        }
        expect(decoder.decode(bytes)).toBe(expectedOut)
      })
    }

    if (c.str && c.bytes) {
      it(`encode: ${c.name}`, () => {
        const encoder = new TextEncoder()
        expect([...encoder.encode(c.str)]).toEqual(c.bytes)
      })
    }

    if (c.splits) {
      it(`stream decode: ${c.name}`, () => {
        const decoder = new TextDecoder()
        let out = ''
        for (const part of c.splits) out += decoder.decode(new Uint8Array(part), { stream: true })
        out += decoder.decode()
        expect(out).toBe(c.expected)
      })
    }
  }

  it('fatal:true 对合法输入正常解码', () => {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    expect(decoder.decode(new Uint8Array([0xe5, 0xb0, 0x8f]))).toBe('小')
  })

  it('encodeInto 处理缓冲区边界(4 字节字符放不下时停在前一个字符)', () => {
    const encoder = new TextEncoder()
    const dest = new Uint8Array(3)
    const result = encoder.encodeInto('ab𝄞', dest)
    expect(result).toEqual({ read: 2, written: 2 })
    expect([...dest]).toEqual([97, 98, 0])
  })

  it('encodeInto 完整写入', () => {
    const encoder = new TextEncoder()
    const dest = new Uint8Array(10)
    const result = encoder.encodeInto('小𝄞', dest)
    expect(result.read).toBe(3)
    expect(result.written).toBe(7)
  })

  it('不支持的编码标签抛 RangeError', () => {
    expect(() => new TextDecoder('gbk')).toThrowError(RangeError)
  })

  it('BOM 分块到达时仍被剥离', () => {
    const decoder = new TextDecoder()
    let out = decoder.decode(new Uint8Array([0xef]), { stream: true })
    out += decoder.decode(new Uint8Array([0xbb, 0xbf, 0x61]), { stream: true })
    out += decoder.decode()
    expect(out).toBe('a')
  })
})
