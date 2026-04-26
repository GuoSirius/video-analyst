import { defineConfig, presetUno, presetIcons, transformerDirectives } from 'unocss'

export default defineConfig({
  presets: [
    presetUno(),
    presetIcons({
      scale: 1.2,
      cdn: 'https://esm.sh/'
    })
  ],
  transformers: [
    transformerDirectives()
  ],
  shortcuts: {
    'btn': 'px-4 py-2 rounded-md cursor-pointer select-none transition-colors duration-200',
    'btn-primary': 'btn bg-blue-500 text-white hover:bg-blue-600',
    'btn-ghost': 'btn bg-transparent hover:bg-gray-100 dark:hover:bg-gray-700'
  },
  theme: {
    colors: {
      primary: '#409EFF'
    }
  }
})
