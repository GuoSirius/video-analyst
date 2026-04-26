import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'
import globals from 'globals'

const isProduction = process.env.NODE_ENV === 'production';

// TypeScript ESLint 插件规则
const tsEslintRules = {
  '@typescript-eslint/ban-ts-comment': 'off',
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/no-unused-vars': ['off', {
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_'
  }],
  '@typescript-eslint/explicit-function-return-type': 'off',
  '@typescript-eslint/explicit-module-boundary-types': 'off',
  '@typescript-eslint/no-non-null-assertion': 'off',
  '@typescript-eslint/consistent-type-imports': 'off',
  '@typescript-eslint/no-empty-object-type-type': 'off',
  '@typescript-eslint/no-require-imports': 'off'
}

// console 和 debugger 规则：生产环境禁止，开发环境允许
const consoleRules = isProduction ? {
  'no-console': 'error',
  'no-debugger': 'error'
} : {
  'no-console': 'off',
  'no-debugger': 'off'
}

export default [
  // 忽略文件
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'node_modules/**',
      '*.min.js',
      'coverage/**'
    ]
  },

  // JavaScript 文件
  {
    files: ['**/*.js', '**/*.mjs'],
    rules: {
      ...js.configs.recommended.rules,
      ...consoleRules,
      'no-unused-vars': 'off'
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  },

  // Vue 文件 - 使用 vue-eslint-parser
  {
    files: ['**/*.vue'],
    plugins: {
      vue: pluginVue
    },
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      ...pluginVue.configs['vue3-recommended']?.rules || {},
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'off',
      'vue/require-default-prop': 'off',
      'vue/require-explicit-emits': 'off',
      'vue/no-unused-vars': 'off',
      'vue/no-unused-components': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },

  // TypeScript 文件
  {
    files: ['**/*.ts', '**/*.tsx', 'electron/**/*.ts'],
    plugins: {
      '@typescript-eslint': tseslint.plugin
    },
    languageOptions: {
      parser: tseslint.parser,
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      ...tsEslintRules,
      ...consoleRules
    }
  }
]
