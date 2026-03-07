// Hathor WalletConnect session management via Reown AppKit UniversalConnector.
// This module is imported by main.js and exposes window.HathorWallet for use
// by the existing non-module index.js.

const HATHOR_MAINNET = {
  id: 1,
  chainNamespace: 'hathor',
  caipNetworkId: 'hathor:mainnet',
  name: 'Hathor Mainnet',
  nativeCurrency: { name: 'HTR', symbol: 'HTR', decimals: 2 },
  rpcUrls: { default: { http: ['https://node1.mainnet.hathor.network/v1a/'] } },
}

const HATHOR_TESTNET = {
  id: 2,
  chainNamespace: 'hathor',
  caipNetworkId: 'hathor:testnet',
  name: 'Hathor Testnet',
  nativeCurrency: { name: 'HTR', symbol: 'HTR', decimals: 2 },
  rpcUrls: { default: { http: ['https://node1.testnet.hathor.network/v1a/'] } },
}

// RPC methods supported by the Hathor wallet (HathorNetwork/rfcs rpc-protocol.md)
const HATHOR_METHODS = [
  'htr_sendTx',
  'htr_getBalance',
  'htr_getAddress',
  'htr_getConnectedNetwork',
  'htr_getUtxos',
  'htr_createToken',
  'htr_signWithAddress',
  'htr_sendNanoContractTx',
  'htr_getOperationStatus',
]

// Replace with your Reown project ID from https://cloud.reown.com
const REOWN_PROJECT_ID = '290d89689d2588c921b6ef184ae8ee55'

const METADATA = {
  name: 'Hathor Bridge',
  description: 'Token bridge between Hathor and Arbitrum',
  url: window.location.origin,
  icons: [`${window.location.origin}/assets/storm-labs-reduced-logo.png`],
}

const HTR_ADDRESS_KEY = 'htr_wallet_address'

let universalConnector = null
let activeSession = null
let hathorAddress = null

async function initConnector(isTestnet) {
  try {
    const { UniversalConnector } = window.ReownAppKit
    const network = isTestnet ? HATHOR_TESTNET : HATHOR_MAINNET
    universalConnector = await UniversalConnector.init({
      projectId: REOWN_PROJECT_ID,
      metadata: METADATA,
      networks: [
        {
          methods: HATHOR_METHODS,
          chains: [network],
          events: [],
          namespace: 'hathor',
        },
      ],
    })
    return universalConnector
  }
  catch (e) {
    console.error('Failed to initialize UniversalConnector:', e)
    throw e
  }
}

async function connect(isTestnet) {
  if (!universalConnector) {
    await initConnector(isTestnet)
  }
  const { session } = await universalConnector.connect()
  activeSession = session

  // Session accounts are in format "hathor:mainnet:H<address>"
  const accounts = session.namespaces?.hathor?.accounts ?? []
  if (accounts.length > 0) {
    hathorAddress = accounts[0].split(':')[2]
  }
  localStorage.setItem(HTR_ADDRESS_KEY, hathorAddress)
  return { session, address: hathorAddress }
}

async function disconnect() {
  if (universalConnector) {
    try {
      await universalConnector.disconnect()
    } catch (_) {}
  }
  activeSession = null
  hathorAddress = null
  localStorage.removeItem(HTR_ADDRESS_KEY)
}

async function getBalance(tokenUid, isTestnet) {
  if (!universalConnector || !activeSession) throw new Error('Hathor wallet not connected')
  const network = isTestnet ? 'testnet' : 'mainnet'
  const result = await universalConnector.request({
    method: 'htr_getBalance',
    params: [{ tokens: [tokenUid], network }],
  })
  // result: { [tokenUid]: { available: number, locked: number } }
  return result
}

/**
 * Build and send the Hathor transaction that initiates an HTR→EVM bridge transfer.
 *
 * The transaction contains two outputs:
 *   1. Token output  — sends `amountUnits` of `tokenUid` to the bridge deposit address
 *   2. Data output   — encodes the EVM destination address as raw hex (OP_RETURN style)
 *      The bridge backend parses this to route tokens to the correct EVM address.
 *
 * @param {string}  bridgeHathorAddress  Hathor deposit address of the bridge
 * @param {string}  tokenUid             Hathor token UID (32-byte hex) or "00" for native HTR
 * @param {number}  amountUnits          Amount in the token's smallest unit (integer)
 * @param {string}  evmDestAddress       EVM destination address (0x...)
 * @param {boolean} isTestnet
 * @returns {{ hash: string }}           Hathor transaction ID
 */
async function sendBridgeTx(bridgeHathorAddress, tokenUid, amountUnits, evmDestAddress, isTestnet) {
  if (!universalConnector || !activeSession) throw new Error('Hathor wallet not connected')
  const network = isTestnet ? 'testnet' : 'mainnet'

  // Strip 0x prefix; EVM address becomes 40-char hex string
  const evmHex = evmDestAddress.replace(/^0x/, '').toLowerCase()

  const params = [
    {
      outputs: [
        {
          address: bridgeHathorAddress,
          value: amountUnits,
          token: tokenUid,
        },
        {
          type: 'data',
          data: evmHex,
        },
      ],
      network,
      push_tx: true,
    },
  ]

  const result = await universalConnector.request({
    method: 'htr_sendTx',
    params,
  })
  // result: { hash: "<hathor_tx_id>" }
  return result
}

async function restoreSession(isTestnet) {
  try {
    await initConnector(isTestnet)
    // UniversalProvider restores the last session automatically on init.
    // The active session is available at provider.session.
    const session = universalConnector?.provider?.session
    if (!session) {
      console.log('No existing Hathor wallet session found.')
      localStorage.removeItem(HTR_ADDRESS_KEY)
      return null
    }
    activeSession = session
    const accounts = activeSession.namespaces?.hathor?.accounts ?? []
    if (accounts.length > 0) {
      console.log('Restored Hathor wallet session with address:', accounts[0])
      hathorAddress = accounts[0].split(':')[2]
    } else {
      console.warn('Restored Hathor wallet session has no accounts')
      hathorAddress = localStorage.getItem(HTR_ADDRESS_KEY)
    }
    return { address: hathorAddress }
  } catch (e) {
    console.warn('Hathor session restore failed:', e)
    return null
  }
}

window.HathorWallet = {
  connect,
  disconnect,
  restoreSession,
  getBalance,
  sendBridgeTx,
  getAddress: () => hathorAddress,
  isConnected: () => activeSession !== null,
};

// Auto-restore session on page load and notify index.js via a DOM event.
(async () => {
  const isTestnet = window.location.href.includes('testnet')
  const restored = await restoreSession(isTestnet)
  if (restored?.address) {
    window.dispatchEvent(new CustomEvent('hathorWalletRestored', { detail: restored }))
  }
})()
