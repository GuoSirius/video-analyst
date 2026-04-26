import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import unoCSS from 'unocss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/main',
      lib: {
        entry: resolve(__dirname, 'electron/main.ts')
      },
      rollupOptions: {
        output: {
          format: 'es'
        }
      },
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/preload',
      lib: {
        entry: resolve(__dirname, 'electron/preload.ts')
      },
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true
        }
      }
    }
  },
  renderer: {
    root: '.',
    build: {
      outDir: 'dist-electron/renderer',
      rollupOptions: {
        input: resolve(__dirname, 'index.html')
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src')
      }
    },
    plugins: [
      vue(),
      unoCSS()
    ],
    server: {
      host: '127.0.0.1',
      port: 5173
    }
  }
})
