/** 引擎签名:与上游对 tr46.toASCII 的调用等价;返回 null 表示解析失败。 */
export type DomainToAsciiEngine = (domain: string, beStrict: boolean) => string | null

export function liteDomainToAscii(domain: string, beStrict?: boolean): string | null
export function getDomainToAscii(): DomainToAsciiEngine
export function setDomainToAsciiEngine(engine: DomainToAsciiEngine): void
export function resetDomainToAsciiEngine(): void
