import { describe, expect, it } from 'vitest'
import { URL, URLSearchParams } from '@cornworld/mp-url'

interface UrlCase {
  name: string
  input: string
  base?: string
  throws?: boolean
  expected?: Record<string, string>
  expectedSearchParams?: Record<string, string>
}

// 语料分工:WPT 全量一致性在 wpt-corpus.test.ts(sync-wpt 生成的 483 例 + pin 门禁);
// 本文件只放上游 urltestdata.json 覆盖不到的语义 —— 上游无 RFC 3986 §5.4 相对解析段
// (base http://a/b/c/d;p?q)、无显式/空端口保留、无路径 %20 与 %2F 正例、无无 base 抛错正例。
// 用例格式与 WPT 条目同构(input/base/expected 分量),方便日后并入语料 runner。
const cases: UrlCase[] = [
  {
    name: 'absolute-http-minimal',
    input: 'http://example.com',
    expected: {
      href: 'http://example.com/',
      protocol: 'http:',
      hostname: 'example.com',
      port: '',
      pathname: '/',
      search: '',
      hash: '',
    },
  },
  {
    name: 'host-lowercased-and-default-port-dropped',
    input: 'http://EXAMPLE.COM:80/a',
    expected: { href: 'http://example.com/a', origin: 'http://example.com' },
  },
  {
    name: 'https-default-port',
    input: 'https://example.com:443/x',
    expected: { href: 'https://example.com/x', port: '', origin: 'https://example.com' },
  },
  {
    name: 'explicit-port-kept',
    input: 'http://example.com:8080/x',
    expected: { port: '8080', origin: 'http://example.com:8080' },
  },
  {
    name: 'empty-port',
    input: 'http://example.com:/a',
    expected: { href: 'http://example.com/a', port: '' },
  },
  {
    name: 'dot-segments-rfc3986-5422',
    input: 'http://a/b/c/./../../g',
    expected: { href: 'http://a/g' },
  },
  {
    name: 'ws-special-scheme',
    input: 'wss://example.com/x',
    expected: { protocol: 'wss:', origin: 'wss://example.com' },
  },
  {
    name: 'space-in-path-percent-encoded',
    input: 'https://example.com/a b',
    expected: { href: 'https://example.com/a%20b' },
  },
  { name: 'query-kept', input: 'http://example.com/?a=1&b=2', expected: { search: '?a=1&b=2' } },
  {
    name: 'encoded-slash-not-decoded-in-path',
    input: 'http://example.com/a%2Fb',
    expected: { pathname: '/a%2Fb' },
  },
  { name: 'relative-no-base-throws', input: 'g', throws: true },
  { name: 'garbage-throws', input: 'not a url', throws: true },
  {
    name: 'relative-rfc3986-normal-g',
    input: 'g',
    base: 'http://a/b/c/d;p?q',
    expected: { href: 'http://a/b/c/g' },
  },
  {
    name: 'relative-rfc3986-normal-dotdot',
    input: '../g',
    base: 'http://a/b/c/d;p?q',
    expected: { href: 'http://a/b/g' },
  },
  {
    name: 'relative-rfc3986-normal-slashg',
    input: '/./g',
    base: 'http://a/b/c/d;p?q',
    expected: { href: 'http://a/g' },
  },
  {
    name: 'relative-rfc3986-normal-slashes',
    input: '//g',
    base: 'http://a/b/c/d;p?q',
    expected: { href: 'http://g/' },
  },
  {
    name: 'relative-query',
    input: '?y',
    base: 'http://a/b/c/d;p?q',
    expected: { href: 'http://a/b/c/d;p?y' },
  },
  {
    name: 'relative-fragment',
    input: '#s',
    base: 'http://a/b/c/d;p?q',
    expected: { href: 'http://a/b/c/d;p?q#s' },
  },
  {
    name: 'searchparams-visible-from-url',
    input: 'http://example.com/?a=1&b=2',
    expectedSearchParams: { a: '1', b: '2' },
  },
]

describe('URL(WPT 移植用例,引擎 whatwg-url)', () => {
  for (const c of cases) {
    it(`parse: ${c.name}`, () => {
      if (c.throws) {
        expect(() => new URL(c.input, c.base)).toThrowError(TypeError)
        return
      }
      const u = new URL(c.input, c.base)
      for (const [key, value] of Object.entries(c.expected ?? {})) {
        expect((u as unknown as Record<string, unknown>)[key]).toBe(value)
      }
      if (c.expectedSearchParams) {
        for (const [key, value] of Object.entries(c.expectedSearchParams)) {
          expect(u.searchParams.get(key)).toBe(value)
        }
      }
    })
  }

  it('canParse / parse', () => {
    expect(URL.canParse('http://example.com')).toBe(true)
    expect(URL.canParse('g', 'http://a/b/c')).toBe(true)
    expect(URL.canParse('not a url')).toBe(false)
    expect(URL.parse('not a url')).toBeNull()
    expect(URL.parse('http://example.com/x')?.pathname).toBe('/x')
  })

  it('href setter 重新解析并在非法输入时抛 TypeError', () => {
    const u = new URL('http://example.com/')
    u.href = 'https://example.org/path'
    expect(u.href).toBe('https://example.org/path')
    expect(() => {
      u.href = '///'
    }).toThrowError(TypeError)
  })

  it('可从另一个 URL 实例解析(EventSource 场景)', () => {
    const base = new URL('http://example.com/sse/')
    const resolved = new URL('events', base)
    expect(resolved.href).toBe('http://example.com/sse/events')
  })

  it('toJSON 与 toString 一致', () => {
    const u = new URL('http://example.com/x?y=1')
    expect(u.toJSON()).toBe(u.toString())
  })
})

describe('URLSearchParams(WHATWG urlencoded 序列化)', () => {
  it('加号解码为空格', () => {
    expect(new URLSearchParams('a=b+c').get('a')).toBe('b c')
  })

  it('重复键:get 首个,getAll 全部', () => {
    const p = new URLSearchParams('a=1&a=2')
    expect(p.get('a')).toBe('1')
    expect(p.getAll('a')).toEqual(['1', '2'])
  })

  it('set 覆盖所有同名键', () => {
    const p = new URLSearchParams('a=1&b=2&a=3')
    p.set('a', 'x')
    expect(p.toString()).toBe('a=x&b=2')
  })

  it('sort 按键名排序', () => {
    const p = new URLSearchParams('b=2&a=1')
    p.sort()
    expect(p.toString()).toBe('a=1&b=2')
  })

  it('对象与迭代器初始化', () => {
    expect(new URLSearchParams({ a: '1' }).toString()).toBe('a=1')
    expect(new URLSearchParams([['a', '1']] as Iterable<[string, string]>).toString()).toBe('a=1')
  })

  it('特殊字符序列化:空格为 +,& 转义', () => {
    expect(new URLSearchParams({ a: 'a b' }).toString()).toBe('a=a+b')
    expect(new URLSearchParams({ a: '1&2' }).toString()).toBe('a=1%262')
  })

  it('delete 不存在的键是无害的', () => {
    const p = new URLSearchParams('a=1')
    p.delete('missing')
    expect(p.has('missing')).toBe(false)
    expect(p.get('a')).toBe('1')
  })

  it('entries 按插入顺序迭代', () => {
    expect([...new URLSearchParams('b=2&a=1').entries()]).toEqual([
      ['b', '2'],
      ['a', '1'],
    ])
  })
})
