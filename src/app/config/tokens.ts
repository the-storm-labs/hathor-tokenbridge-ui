import type { Deployment } from '../domain/model/deployment'
import type { Token, TokenOnHathor } from '../domain/model/token'

/**
 * Icons as **imports**, not as path strings.
 *
 * These used to read `'./assets/img/usdc.png'`, which is a plain string as far
 * as the bundler is concerned: nothing links it to a file, so the image was
 * never emitted and `/assets/img/` did not exist in the build. It worked in
 * `npm run dev` — Vite serves `src/` as the document root there, so the path
 * happened to resolve — and 404'd in every deployed build. The `<img>` tags in
 * the HTML were fine throughout, because Vite's HTML parser does see those.
 *
 * Importing makes the file part of the graph: Vite emits it with a content hash
 * and hands back the final URL, which is also absolute, so it no longer depends
 * on the path of the page doing the asking.
 */
import usdcIcon from '../../assets/img/usdc.png'
import hathorIcon from '../../assets/img/hathor.png'

/**
 * Bridgeable tokens, ported verbatim from index.js.
 *
 * The original baked the `isTestnet` global into each token literal with a
 * ternary, so a token object could only ever describe the deployment the page
 * happened to be. Here each deployment gets its own table, which is what makes
 * the whole set testable at once.
 *
 * ## Verified state of these values (checked against the live networks)
 *
 * **Mainnet is coherent.** `hUSDC` (`00003b17…`) resolves on the Hathor mainnet
 * node as "Hathor USDC", and the bridge deposit address holds a real balance of
 * it. Note USDC's ternary in the original read `!isTestnet ? A : B` while every
 * other token read `isTestnet ? A : B` — an inconsistent *ordering*, not an
 * inverted mapping. The values were correct; this file removes the ambiguity.
 *
 * **The testnet token UIDs are stale.** None of the three (`000000006c82…`
 * USDC, `000002c993…` SLT7, `00000187db…` HTOG3) resolve on the current Hathor
 * testnet, which is `testnet-india`; they date from the `golf` testnet, which
 * was reset. They are preserved verbatim here because a refactor must not invent
 * on-chain addresses — but HTR→ARB transfers on testnet.html cannot work until
 * someone re-mints these and updates this table.
 *
 * ## `hathor.decimals` is the precision on Hathor, not on the EVM side
 *
 * Every `hathor.decimals` here is 2, and that is measured, not assumed: a
 * 5 hUSDC transfer appears on-chain as `value: 500`, and 2 HTR as `value: 200`.
 * Hathor v1 tokens are all 2-decimal and the node's token API exposes no
 * decimals field at all.
 *
 * These fields previously mirrored the EVM decimals (6 for USDC, 18 for aHTR),
 * which was simply wrong — nothing read them, so the fiction went unnoticed
 * while a hardcoded constant did the real work. **Do not "restore" them to match
 * `evm.decimals`.** The two sides genuinely differ: USDC is 6 on Arbitrum and 2
 * on Hathor.
 *
 * This field is now the single source of truth for every Hathor-side amount —
 * inputs, balances and display. A token with a different precision only has to
 * declare it here.
 */

/** Placeholder for a token that is not bridgeable on a given deployment. */
const NOT_ON_HATHOR: TokenOnHathor = {
  symbol: '',
  address: '',
  hathorAddr: '',
  pureHtrAddress: '',
  decimals: 0,
}

const MAINNET_TOKENS: readonly Token[] = [
  {
    key: 'USDC',
    name: 'USDC',
    icon: usdcIcon,
    evm: { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
    hathor: {
      symbol: 'hUSDC',
      address: '0x66981C5a01db0Df1De03A5Af4493437B98F5D49c',
      hathorAddr: '0x00003b17e8d656e4612926d5d2c5a4d5b3e4536e6bebc61c76cb71a65b81986f',
      pureHtrAddress: '00003b17e8d656e4612926d5d2c5a4d5b3e4536e6bebc61c76cb71a65b81986f',
      decimals: 2,
    },
  },
  {
    key: 'SLT7',
    name: 'Storm Labs Token 7',
    icon: 'https://assets.coingecko.com/coins/images/279/standard/ethereum.png?1696501628',
    // Never had a 42161 entry, so it does not appear in the mainnet dropdown.
    evm: null,
    hathor: NOT_ON_HATHOR,
  },
  {
    key: 'aHTR',
    name: 'Hathor Token',
    icon: hathorIcon,
    evm: { symbol: 'aHTR', address: '0x87ca1aC7697c1240518b464B02E92A856D81Aee1', decimals: 18 },
    hathor: {
      symbol: 'HTR',
      address: '0xE3f0Ae350EE09657933CD8202A4dd563c5af941F',
      hathorAddr: '00',
      pureHtrAddress: '00',
      decimals: 2,
    },
  },
  {
    key: 'HTOG3',
    name: 'Hathor Togger 3',
    icon: hathorIcon,
    evm: null,
    hathor: NOT_ON_HATHOR,
  },
]

const TESTNET_TOKENS: readonly Token[] = [
  {
    key: 'USDC',
    name: 'USDC',
    icon: usdcIcon,
    evm: { symbol: 'USDC', address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6 },
    hathor: {
      symbol: 'hUSDC',
      address: '0xA3FBbF66380dEEce7b7f7dC4BEA6267c05bB383D',
      hathorAddr: '0x000000006c82966f45145fdc6caef7676ecbbbe7a0e7fc3025b9b69e217db7d8',
      pureHtrAddress: '000000006c82966f45145fdc6caef7676ecbbbe7a0e7fc3025b9b69e217db7d8',
      decimals: 2,
    },
  },
  {
    key: 'SLT7',
    name: 'Storm Labs Token 7',
    icon: 'https://assets.coingecko.com/coins/images/279/standard/ethereum.png?1696501628',
    evm: { symbol: 'SLT7', address: '0x97118caaE1F773a84462490Dd01FE7a3e7C4cdCd', decimals: 18 },
    hathor: {
      symbol: 'hSLT7',
      address: '0xAF8aD2C33c2c9a48CD906A4c5952A835FeB25696',
      hathorAddr: '0x000002c993795c9ef5b894571af2277aaf344438c2f8608a50daccc6ace7c0a1',
      pureHtrAddress: '000002c993795c9ef5b894571af2277aaf344438c2f8608a50daccc6ace7c0a1',
      decimals: 2,
    },
  },
  {
    key: 'aHTR',
    name: 'Hathor Token',
    icon: hathorIcon,
    evm: { symbol: 'aHTR', address: '0x87ca1aC7697c1240518b464B02E92A856D81Aee1', decimals: 18 },
    hathor: {
      symbol: 'HTR',
      address: '0xE3f0Ae350EE09657933CD8202A4dd563c5af941F',
      hathorAddr: '00',
      pureHtrAddress: '00',
      decimals: 2,
    },
  },
  {
    key: 'HTOG3',
    name: 'Hathor Togger 3',
    icon: hathorIcon,
    evm: { symbol: 'hTOG3', address: '0x245028F6D4C2F2527309EcaE5e82F0f9fb793b7b', decimals: 18 },
    hathor: {
      symbol: 'hTOG3',
      address: '0x92Ef82Fd2Ae42aaF96b9cbE520a0AEeEF4490B7e',
      hathorAddr: '0x00000187dbbc34f5dfd0dd894ea0758666c8f090922f9f5e347c4c3938a1dd1e',
      pureHtrAddress: '00000187dbbc34f5dfd0dd894ea0758666c8f090922f9f5e347c4c3938a1dd1e',
      decimals: 2,
    },
  },
]

/**
 * Arbitrum Sepolia ↔ Hathor testnet (the 2-of-3 multisig bridge). One token:
 * tUSDC is EVM-native (lock/mint out, melt/release back), and nothing else is
 * whitelisted in this AllowTokens.
 *
 * `hathor.address` has no side-token contract behind it — tUSDC is native to
 * the EVM, so none exists. It is `Bridge.uidToAddress(uid)`, the same
 * convention as HTR's entry above; the token lookup only uses it as one more
 * candidate, and on-chain the token shows up as the tUSDC address or `0x` + uid,
 * both of which it already covers.
 */
const TESTNET_ARB_TOKENS: readonly Token[] = [
  {
    key: 'USDC',
    name: 'USDC',
    icon: usdcIcon,
    evm: { symbol: 'tUSDC', address: '0xACCEbd30ce0206c8d0482E21C8a018391dB368a6', decimals: 6 },
    hathor: {
      symbol: 'hUSDC',
      address: '0xB794b5C49a73ac63c396858e42bf1884Fd3e2696',
      hathorAddr: '0x00a83f5072386920b3ee4e843f71e2f1c1c9545b96346af0df32bf332605a2d0',
      pureHtrAddress: '00a83f5072386920b3ee4e843f71e2f1c1c9545b96346af0df32bf332605a2d0',
      decimals: 2,
    },
  },
]

const TOKENS_BY_DEPLOYMENT: Record<Deployment, readonly Token[]> = {
  mainnet: MAINNET_TOKENS,
  testnet: TESTNET_TOKENS,
  'testnet-arb': TESTNET_ARB_TOKENS,
}

export function tokensFor(deployment: Deployment): readonly Token[] {
  return TOKENS_BY_DEPLOYMENT[deployment]
}

export function findToken(deployment: Deployment, key: string): Token | null {
  return tokensFor(deployment).find((token) => token.key === key) ?? null
}
