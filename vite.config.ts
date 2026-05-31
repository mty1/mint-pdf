import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  build: {
    cssCodeSplit: false,
    assetsInlineLimit: 1024 * 1024,
    rolldownOptions: {
      output: {
        codeSplitting: false,
      },
    },
  },
  plugins: [vue()],
})
