import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  build: {
    // The XLSX parser is a separate lazy-loaded chunk used only by roster import.
    chunkSizeWarningLimit: 550,
  },
})
