import { defineConfig } from 'vite'
import { cp } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const srcDir = fileURLToPath(new URL('./src', import.meta.url))
const outDir = fileURLToPath(new URL('./public', import.meta.url))

/**
 * Vite only processes `type="module"` scripts, and src/app is reached through
 * the module entry so it is bundled. What remains in src/js are classic scripts
 * that keep their source paths in the HTML, so they have to be copied verbatim.
 *
 * The list of files to exclude is gone: every bundled module now lives under
 * src/app, which this never copies.
 */
function copyLegacyAssets() {
  return {
    name: 'copy-legacy-assets',
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
  plugins: [copyLegacyAssets()],
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
