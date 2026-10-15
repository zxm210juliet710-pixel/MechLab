
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 部署路径
export default defineConfig({
  plugins: [react()],
  base: '/MechLab/',
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
})
