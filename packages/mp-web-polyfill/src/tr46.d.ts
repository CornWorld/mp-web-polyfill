/**
 * tr46 v5(UTS46/IDNA 数据表)无官方类型,这里按消费面做最小声明。
 * 仅被 ./url/idna(全量 IDNA 增强, 独立 bundle)引用, 默认 lite 引擎不经过它。
 */
declare module 'tr46' {
  export interface ToAsciiOptions {
    beStrict?: boolean
    checkHyphens?: boolean
    checkBidi?: boolean
    checkJoiners?: boolean
    useSTD3ASCIIRules?: boolean
    transitionalProcessing?: boolean
    verifyDNSLength?: boolean
    ignoreInvalidPunycode?: boolean
  }
  export function toASCII(domain: string, options?: ToAsciiOptions): string | null
  export function toUnicode(domain: string, options?: ToAsciiOptions): string | null
}
