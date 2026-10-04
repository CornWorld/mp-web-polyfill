// Vendored from whatwg-url@14.2.0/lib/infra.js(MIT,© jsdom 团队)
// https://github.com/jsdom/whatwg-url/tree/v14.2.0/lib/infra.js
// 与上游唯一差异:CJS→ESM 机械转换(导出面与语义一致),引擎回归由 WPT 语料门禁守护。
// —— 以下为上游原文 ——
'use strict'

// Note that we take code points as JS numbers, not JS strings.

function isASCIIDigit(c) {
  return c >= 0x30 && c <= 0x39
}

function isASCIIAlpha(c) {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)
}

function isASCIIAlphanumeric(c) {
  return isASCIIAlpha(c) || isASCIIDigit(c)
}

function isASCIIHex(c) {
  return isASCIIDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66)
}

export { isASCIIDigit, isASCIIAlpha, isASCIIAlphanumeric, isASCIIHex }
