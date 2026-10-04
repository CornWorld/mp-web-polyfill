import { toASCII } from 'tr46'
import { setDomainToAsciiEngine } from './engine/domain-engine.js'

/**
 * 全量 IDNA 域名引擎(UTS46,经 tr46):非 ASCII 域名 → punycode,
 * 行为与 whatwg-url 上游一致(选项逐字对齐其 domainToASCII)。
 *
 * 这是「按需增强」开关:import 本模块即自动安装(幂等);不安装时
 * URL 引擎使用默认 lite 引擎(仅 ASCII 域名 —— 小程序合法域名硬性
 * 要求 ICP 备案 ASCII 域名,该默认在本环境无语义损失)。
 * 本子路径是独立 bundle:tr46 的 UTS46 数据表(~213KB)只有显式
 * import 这里的消费方才会携带,不会进入默认模块图。
 */
export function installIdnaDomainEngine(): void {
  setDomainToAsciiEngine((domain, beStrict) =>
    toASCII(domain, {
      checkHyphens: beStrict,
      checkBidi: true,
      checkJoiners: true,
      useSTD3ASCIIRules: beStrict,
      transitionalProcessing: false,
      verifyDNSLength: beStrict,
      ignoreInvalidPunycode: false,
    }),
  )
}

// import 即安装(幂等)
installIdnaDomainEngine()
