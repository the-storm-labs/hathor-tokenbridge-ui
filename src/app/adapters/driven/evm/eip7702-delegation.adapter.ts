import type { Address, Hex } from 'viem'
import type { Eip7702Port } from '../../../ports/driven/eip7702.port'
import { parseEip7702Delegate } from '../../../domain/eip7702'

/**
 * The one viem client method this adapter needs, kept narrow so a test can
 * fake it without standing up a transport.
 */
export interface CodeReader {
  getCode(args: { address: Address }): Promise<Hex | undefined>
}

/**
 * Reads a destination's EIP-7702 delegation over a plain JSON-RPC client, not
 * the connected wallet's provider: the HTR→ARB form works with no EVM wallet
 * connected at all — the destination is often just typed in — so
 * `ViemChainAdapter`'s wallet-backed client is the wrong tool here.
 * `VITE_EVM_HOST_MAINNET`/`VITE_EVM_HOST_TESTNET` were wired through CI for
 * exactly this: a fallback RPC nothing read until now (see `.env.example`).
 *
 * Fails open: a read that throws — bad RPC, network hiccup, the env var
 * missing in a local build — resolves to `null`, same as "no delegation".
 * Blocking every HTR→ARB transfer whenever this side channel is unreachable
 * would be worse than occasionally missing the guard it adds: the bridge
 * contract still refuses a delegated claim on its own, this only saves the
 * wait to discover that.
 */
export class ViemEip7702Adapter implements Eip7702Port {
  constructor(private readonly client: CodeReader) {}

  async getDelegate(address: string): Promise<string | null> {
    try {
      const code = await this.client.getCode({ address: address as Address })
      return parseEip7702Delegate(code ?? null)
    } catch (error) {
      console.error('Could not check EIP-7702 delegation', error)
      return null
    }
  }
}
