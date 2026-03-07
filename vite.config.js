import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../public',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'src/index.html',
        testnet: 'src/testnet.html',
      }
    }
  }
})
