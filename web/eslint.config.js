import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  // 忽略产物和缓存目录
  { ignores: ['dist', 'dist-electron', 'node_modules', 'scripts'] },

  // JS 推荐规则
  js.configs.recommended,

  // TypeScript 推荐规则（严格模式）
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // React Hooks 规则
      ...reactHooks.configs.recommended.rules,
      // effect 内同步 setState 是合法的常见写法，关闭误报
      'react-hooks/set-state-in-effect': 'off',

      // React Refresh（Vite HMR）
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // 未使用变量：存量问题降为 warn，避免阻断开发
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],

      // 禁止 any（与 tsconfig strict 对齐）
      '@typescript-eslint/no-explicit-any': 'warn',

      // 允许空函数（catch 块常见）
      '@typescript-eslint/no-empty-function': 'off',

      // 允许非空断言（谨慎使用，不完全禁止）
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // console.log 在合并前必须删除
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // 禁止 debugger
      'no-debugger': 'error',
    },
  },
)
