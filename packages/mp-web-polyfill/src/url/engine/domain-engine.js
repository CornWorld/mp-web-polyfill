// 域名转 ASCII 注入缝(状态机唯一的服务器接缝)。
// 签名与 whatwg-url 上游对 tr46.toASCII 的调用等价:(domain, beStrict) => string | null。
//
// 默认 lite 引擎:仅 ASCII 域名(大小写折叠,非 ASCII 一律判失败)。
// 依据:小程序网络 API 合法域名硬性要求 ICP 备案的 ASCII 域名,完整 IDNA
// 的 213KB UTS46 数据表在该环境无合法输入可达 —— 按需启用见 ./idna
// (独立 bundle,import 即安装全量 IDNA,tr46 不会进入默认模块图)。
const ENGINE_KEY = Symbol.for('cornworld.mp-polyfill.domainToAscii')

function liteDomainToAscii(domain) {
  return /^[\x00-\x7F]*$/.test(domain) ? domain.toLowerCase() : null
}

function getDomainToAscii() {
  const globalImpl = globalThis[ENGINE_KEY]
  return typeof globalImpl === 'function' ? globalImpl : liteDomainToAscii
}

function setDomainToAsciiEngine(engine) {
  globalThis[ENGINE_KEY] = engine
}

function resetDomainToAsciiEngine() {
  delete globalThis[ENGINE_KEY]
}

export { liteDomainToAscii, getDomainToAscii, setDomainToAsciiEngine, resetDomainToAsciiEngine }
