import { defineConfig, loadEnv } from 'vite'
import { resolve } from 'path'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'

export default defineConfig(({ mode }) => {
  const root = resolve(__dirname, '..')
  const env = loadEnv(mode, root, '')
  const webPort = parseInt(env.WEB_PORT || '5173', 10)

  return {
    plugins: [vue(), UnoCSS()],
    server: {
      host: '0.0.0.0',
      port: webPort,
    },
  }
})
