/**
 * 构建期由 vite define 注入(取自 package.json version),
 * 源码层(单测)下未注入,回退 0.0.0-dev。
 */
declare const __PKG_VERSION__: string
