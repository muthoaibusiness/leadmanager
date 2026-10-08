import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // config/ holds n8n Code-node snippets: they run inside n8n (top-level
  // return), are not part of the app, and do not parse as modules.
  globalIgnores(['dist', 'config']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // useApp() lives beside its provider on purpose and is imported from here
    // by every component; an edit to this file reloads the page instead of
    // hot-swapping, which is fine for the app-wide context.
    files: ['src/context/AppContext.jsx'],
    rules: {
      'react-refresh/only-export-components': ['error', { allowConstantExport: true, allowExportNames: ['useApp'] }],
    },
  },
])
