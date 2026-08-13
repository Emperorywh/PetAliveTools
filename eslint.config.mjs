import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', 'release/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended
)
