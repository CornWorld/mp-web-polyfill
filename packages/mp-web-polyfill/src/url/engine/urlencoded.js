// Vendored from whatwg-url@14.2.0/lib/urlencoded.js(MIT,© jsdom 团队)
// https://github.com/jsdom/whatwg-url/tree/v14.2.0/lib/urlencoded.js
// 与上游唯一差异:CJS→ESM 机械转换(导出面与语义一致),引擎回归由 WPT 语料门禁守护。
// —— 以下为上游原文 ——
'use strict'
import { utf8Encode, utf8DecodeWithoutBOM } from './encoding.js'
import {
  percentDecodeBytes,
  utf8PercentEncodeString,
  isURLEncodedPercentEncode,
} from './percent-encoding.js'

function p(char) {
  return char.codePointAt(0)
}

// https://url.spec.whatwg.org/#concept-urlencoded-parser
function parseUrlencoded(input) {
  const sequences = strictlySplitByteSequence(input, p('&'))
  const output = []
  for (const bytes of sequences) {
    if (bytes.length === 0) {
      continue
    }

    let name, value
    const indexOfEqual = bytes.indexOf(p('='))

    if (indexOfEqual >= 0) {
      name = bytes.slice(0, indexOfEqual)
      value = bytes.slice(indexOfEqual + 1)
    } else {
      name = bytes
      value = new Uint8Array(0)
    }

    name = replaceByteInByteSequence(name, 0x2b, 0x20)
    value = replaceByteInByteSequence(value, 0x2b, 0x20)

    const nameString = utf8DecodeWithoutBOM(percentDecodeBytes(name))
    const valueString = utf8DecodeWithoutBOM(percentDecodeBytes(value))

    output.push([nameString, valueString])
  }
  return output
}

// https://url.spec.whatwg.org/#concept-urlencoded-string-parser
function parseUrlencodedString(input) {
  return parseUrlencoded(utf8Encode(input))
}

// https://url.spec.whatwg.org/#concept-urlencoded-serializer
function serializeUrlencoded(tuples) {
  // TODO: accept and use encoding argument

  let output = ''
  for (const [i, tuple] of tuples.entries()) {
    const name = utf8PercentEncodeString(tuple[0], isURLEncodedPercentEncode, true)
    const value = utf8PercentEncodeString(tuple[1], isURLEncodedPercentEncode, true)

    if (i !== 0) {
      output += '&'
    }
    output += `${name}=${value}`
  }
  return output
}

function strictlySplitByteSequence(buf, cp) {
  const list = []
  let last = 0
  let i = buf.indexOf(cp)
  while (i >= 0) {
    list.push(buf.slice(last, i))
    last = i + 1
    i = buf.indexOf(cp, last)
  }
  if (last !== buf.length) {
    list.push(buf.slice(last))
  }
  return list
}

function replaceByteInByteSequence(buf, from, to) {
  let i = buf.indexOf(from)
  while (i >= 0) {
    buf[i] = to
    i = buf.indexOf(from, i + 1)
  }
  return buf
}

export { parseUrlencodedString, serializeUrlencoded }
