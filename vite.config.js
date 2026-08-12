import { defineConfig } from 'vite'
import { cp } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const srcDir = fileURLToPath(new URL('./src', import.meta.url))
const outDir = fileURLToPath(new URL('./public', import.meta.url))

/**
 * Vite only processes `type="module"` scripts, and the whole app is reached
 * through the module entry so it is bundled. One classic script is left —
 * js/bs58.js, a vendored base58 implementation the page loads as a `<script>`
 * tag and the Hathor address checksum reads off the global. It keeps its source
 * path in the HTML, so it has to be copied verbatim or the deployed site 404s.
 */
function copyVendorScripts() {
  return {
    name: 'copy-vendor-scripts',
    apply: 'build',
    async closeBundle() {
      await cp(`${srcDir}/js`, `${outDir}/js`, { recursive: true })
      // src/abis is deliberately NOT copied: the ABIs are static imports in
      // app/adapters/driven/evm/abis.ts and Vite inlines them into the bundle.
      // Nothing fetches them at runtime any more.
    },
  }
}

export default defineConfig({
  root: 'src',
  plugins: [copyVendorScripts()],
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
