/**
 * whatwg-url 状态机内部 URL record 的形状(供包装类与 ambient 声明共享)。
 * 独立成普通模块而非放在 engine.d.ts 内:普通 .ts 会被 tsc emit 成
 * dist/*.d.ts,发布的类型自包含,消费者不依赖 whatwg-url 的类型。
 */
export interface URLRecord {
  scheme: string
  username: string
  password: string
  host: string | { host: string; isIPv4?: boolean } | null
  port: number | string | null
  path: string[]
  query: string | null
  fragment: string | null
  cannotBeABaseURL?: boolean
}
