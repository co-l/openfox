import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  root: '.',
  build: {
    outDir: '../dist/web',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:10369',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:10369',
        ws: true,
      },
    },
  },
})
