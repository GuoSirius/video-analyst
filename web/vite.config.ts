import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const serverHost = env.SERVER_HOST || '0.0.0.0'
  const serverPort = env.SERVER_PORT || '3000'
  const webPort = parseInt(env.WEB_PORT || '5173', 10)

  return {
    plugins: [vue(), UnoCSS()],
    server: {
      host: '0.0.0.0',
      port: webPort,
      proxy: {
        '/api': {
          target: `http://${serverHost}:${serverPort}`,
          changeOrigin: true,
        },
      },
    },
  }
})
