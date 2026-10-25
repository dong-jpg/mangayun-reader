import { defineConfig } from 'vite'
import { mockServerPlugin } from './server/mock-images.mjs'

export default defineConfig({
  root: __dirname,
  plugins: [mockServerPlugin()],
  build: {
    outDir: '../harness-dist',
    emptyOutDir: true,
    target: 'es2022',
  },
})
