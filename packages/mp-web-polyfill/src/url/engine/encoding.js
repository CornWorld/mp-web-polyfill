// Vendored from whatwg-url@14.2.0/lib/encoding.js(MIT,© jsdom 团队)
// https://github.com/jsdom/whatwg-url/tree/v14.2.0/lib/encoding.js
// 与上游唯一差异:CJS→ESM 机械转换(导出面与语义一致),引擎回归由 WPT 语料门禁守护。
// —— 以下为上游原文 ——
'use strict'
const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder('utf-8', { ignoreBOM: true })

function utf8Encode(string) {
  return utf8Encoder.encode(string)
}

function utf8DecodeWithoutBOM(bytes) {
  return utf8Decoder.decode(bytes)
}

export { utf8Encode, utf8DecodeWithoutBOM }
