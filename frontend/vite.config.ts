import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // noVNC uses top-level await, which needs an ES2022 target.
  build: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  server: {
    proxy: {
      '/api': 'http://localhost:3456',
      '/health': 'http://localhost:3456',
    }
  }
})
