import type { Eip1193Provider } from '../../../ports/driven/evm-wallet.port'
import {
  createPublicClient,
  createWalletClient,
  custom,
  type Address,
  type Abi,
  type PublicClient,
  type WalletClient,
} from 'viem'

/**
 * The pair of viem clients an adapter needs, built over the wallet's provider.
 *
 * Two, because viem separates them: reads go over any transport, writes need an
 * account and go through the wallet. web3.js merged both into one object, which
 * is why every call site looked identical whether or not it moved money.
 */
export interface EvmClients {
  readonly reader: PublicClient
  readonly writer: WalletClient
}

export function createEvmClients(provider: Eip1193Provider): EvmClients {
  const transport = custom(provider)

  return {
    reader: createPublicClient({ transport }),
    writer: createWalletClient({ transport }),
  }
}

/**
 * Reads a contract function.
 *
 * Returns `unknown`: the ABIs are plain JSON, not `as const`, so viem cannot
 * infer a return type from them and pretending otherwise is how a wrong type
 * gets trusted. Every caller narrows, which is the same containment the web3
 * adapter had — just without web3.
 */
export async function readContract(
  clients: EvmClients,
  abi: readonly unknown[],
  address: string,
  functionName: string,
  args: readonly unknown[] = [],
): Promise<unknown> {
  return clients.reader.readContract({
    address: address as Address,
    abi: abi as Abi,
    functionName,
    args,
  })
}

export interface WriteOptions {
  readonly from: string
  /** Hex-encoded, as `gasPriceFor` produces it. */
  readonly gasPrice: string
  readonly gas: bigint
}

/**
 * Submits a write and resolves with the transaction hash.
 *
 * Not the receipt — the hash is what the app needs to link to the explorer, to
 * poll, and to report a revert against; waiting is the caller's decision (see
 * confirmTransaction). web3 needed an event listener to get this; viem returns
 * it, so the promise wrapper that had to catch its own rejection is gone.
 *
 * `chain: null` skips viem's chain check. The wallet's chain is already
 * validated by the wallet-header component before any write is reachable, and
 * the clients are built over the wallet's own provider.
 */
export async function writeContract(
  clients: EvmClients,
  abi: readonly unknown[],
  address: string,
  functionName: string,
  args: readonly unknown[],
  options: WriteOptions,
): Promise<string> {
  return clients.writer.writeContract({
    account: options.from as Address,
    address: address as Address,
    abi: abi as Abi,
    functionName,
    args,
    // Explicit, so viem does not add an eth_estimateGas round trip. The values
    // are the ones web3 was called with.
    gas: options.gas,
    gasPrice: BigInt(options.gasPrice),
    chain: null,
  })
}

export function requireClients(clients: EvmClients | null): EvmClients {
  if (!clients) throw new Error('No EVM provider connected')
  return clients
}
