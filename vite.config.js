import { defineConfig } from 'vite'

/**
 * Everything the page loads is a module now, so nothing has to be copied
 * verbatim: Vite owns the whole graph. The `copy-vendor-scripts` plugin that
 * lived here existed for js/bs58.js, the last classic script, which went with
 * CryptoJS when address validation moved to npm packages.
 */

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../public',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'src/index.html',
        testnet: 'src/testnet.html',
        'testnet-arb': 'src/testnet-arb.html',
      },
    },
  },
})
