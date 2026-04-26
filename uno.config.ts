import { defineConfig, presetUno, presetIcons, transformerDirectives, presetWebFonts } from 'unocss'

export default defineConfig({
  presets: [
    presetUno(),
    presetIcons({
      scale: 1.2,
      cdn: 'https://esm.sh/'
    }),
    presetWebFonts({
      fonts: {
        sans: 'Inter:400,500,600,700',
      },
    })
  ],
  transformers: [
    transformerDirectives()
  ],
  shortcuts: {
    'btn': 'px-4 py-2 rounded-lg cursor-pointer select-none transition-all duration-200',
    'btn-primary': 'btn bg-gradient-to-r from-blue-500 to-cyan-500 text-white hover:shadow-lg hover:shadow-blue-500/25 hover:-translate-y-0.5',
    'btn-ghost': 'btn bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800',
    'card': 'bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-sm',
    'card-hover': 'hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 transition-all duration-300'
  },
  theme: {
    colors: {
      primary: {
        50: '#eff6ff',
        100: '#dbeafe',
        200: '#bfdbfe',
        300: '#93c5fd',
        400: '#60a5fa',
        500: '#3b82f6',
        600: '#2563eb',
        700: '#1d4ed8',
        800: '#1e40af',
        900: '#1e3a8a',
      },
      gradient: {
        primary: 'linear-gradient(135deg, #3b82f6 0%, #0ea5e9 100%)',
        success: 'linear-gradient(135deg, #22c55e 0%, #4ade80 100%)',
        warning: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
        danger: 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)',
      }
    }
  },
  safelist: [
    'from-blue-500',
    'to-cyan-500',
    'hover:shadow-blue-500/25',
    'shadow-blue-500/30',
  ]
})
