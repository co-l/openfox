import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { createViteWatchOptions } from './vite-watch.js'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  root: path.resolve(__dirname),  // Use web/ directory as root
  build: {
    outDir: '../dist/web',
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: createViteWatchOptions(),
    // In dev mode, users access Vite directly (for HMR to work)
    // Vite proxies API/WS to the backend server
    proxy: {
      '/api': {
        target: 'http://localhost:10469',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:10469',
        ws: true,
      },
    },
  },
})
