import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'

export default defineConfig({
  plugins: [react()],
  // noVNC uses top-level await, which needs an ES2022 target.
  build: { target: 'es2022' },
  resolve: {
    // noVNC only exports its RFB entry; MacScreen also needs its logger.
    alias: { 'novnc-logging': fileURLToPath(new URL('./node_modules/@novnc/novnc/core/util/logging.js', import.meta.url)) },
  },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  server: {
    proxy: {
      '/api': 'http://localhost:3456',
      '/health': 'http://localhost:3456',
    }
  }
})
