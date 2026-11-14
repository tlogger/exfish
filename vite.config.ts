import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api-khoa': {
        target: 'https://apis.data.go.kr',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-khoa/, ''),
      },
      '/api-swtc': {
        target: 'https://www.khoa.go.kr',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-swtc/, ''),
      },
    },
  },
})
