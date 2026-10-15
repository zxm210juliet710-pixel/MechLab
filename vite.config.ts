import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 使用相对路径，便于部署到 GitHub Pages 子目录
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
})
