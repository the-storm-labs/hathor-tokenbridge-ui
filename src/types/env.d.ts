/**
 * Build-time configuration, injected into the page by the inline <script> block
 * in index.html / testnet.html via Vite's %VITE_*% HTML placeholders.
 *
 * It lives on `window` rather than being read through `import.meta.env` because
 * the legacy non-module scripts cannot see import.meta. Once src/js is gone,
 * app/config/env.ts is the only reader and can switch to import.meta.env.
 *
 * Values are strings that may still contain an unsubstituted '%VITE_...%'
 * placeholder if the page was deployed without a real Vite build — env.ts is
 * responsible for detecting that rather than trusting these blindly.
 */
interface AppEnv {
  readonly bridgeApiUrl: string
  readonly evmHostMainnet: string
  readonly evmHostTestnet: string
}

interface Window {
  readonly __ENV__?: AppEnv
}
