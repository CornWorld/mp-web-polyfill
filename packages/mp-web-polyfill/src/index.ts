/**
 * 单一聚合入口:全部公共 API 的唯一构建源。
 *
 * 构建为「一线路」形态。vite 仅以本文件为入口, 每格式(esm/cjs)产出一个
 * 真 bundle, package.json 里所有子路径出口的 import/require 都指向同一份产物
 * (types 仍按子路径由 tsc 产出)。这样任何消费组合下全局只有一份类与单例:
 * installer 安装的 Headers 与 ./fetch 导出的 Headers 必然同源, 跨入口
 * instanceof / 单例一致性由产物结构保证(CJS 下多入口构建必然内联副本,
 * esbuild/rollup 均不支持 cjs 共享 chunk, 2026-10-04 修复)。
 */
export * from './core'
export * from './text-encoding'
export * from './url'
export * from './storage'
export * from './fetch'
export * from './eventsource'
export * from './installer'
export * from './fetch/abort'
export * from './fetch/form-data'
export * from './fetch/streams'
