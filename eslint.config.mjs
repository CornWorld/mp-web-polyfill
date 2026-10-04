import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // dist 产物 + vendor 区(src/url/engine:whatwg-url 状态机原文 + CJS 注入缝)
    // 不参与 lint;vendor 的正确性由 WPT 全量语料门禁守护
    ignores: ['**/dist/**', '**/node_modules/**', 'pnpm-lock.yaml', '**/src/url/engine/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
)
