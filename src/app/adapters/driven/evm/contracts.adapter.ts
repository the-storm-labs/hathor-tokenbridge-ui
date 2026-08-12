import type {
  AllowTokensPort,
  BridgeContractPort,
  ClaimRequest,
  Erc20Port,
  FederationPort,
} from '../../../ports/driven/contracts.port'
import { ABIS } from './abis'
import {
  readContract,
  requireClients,
  writeContract,
  type EvmClients,
  type WriteOptions,
} from './clients'

/**
 * The bridge contracts, on viem.
 *
 * This file is where the looseness is contained: the ABIs are plain JSON so
 * reads come back as `unknown`, and every result is narrowed here. That
 * containment is the point of the ports, not a compromise around them.
 */

const asString = (value: unknown): string => (value == null ? '' : String(value))

/** Gas limits, carried over from the web3 adapter unchanged. */
const GAS = {
  approve: 400_000n,
  claim: 400_000n,
  receiveTokensTo: 600_000n,
} as const

export class ViemErc20Adapter implements Erc20Port {
  constructor(private readonly getClients: () => EvmClients | null) {}

  async balanceOf(tokenAddress: string, owner: string): Promise<string> {
    return asString(await this.read(tokenAddress, 'balanceOf', [owner]))
  }

  async allowance(tokenAddress: string, owner: string, spender: string): Promise<string> {
    return asString(await this.read(tokenAddress, 'allowance', [owner, spender]))
  }

  async approve(
    tokenAddress: string,
    spender: string,
    amount: string,
    from: string,
    gasPrice: string,
  ): Promise<string> {
    return writeContract(
      this.clients(),
      ABIS.erc20,
      tokenAddress,
      'approve',
      [spender, BigInt(amount)],
      { from, gasPrice, gas: GAS.approve } satisfies WriteOptions,
    )
  }

  private read(address: string, fn: string, args: readonly unknown[]): Promise<unknown> {
    return readContract(this.clients(), ABIS.erc20, address, fn, args)
  }

  private clients(): EvmClients {
    return requireClients(this.getClients())
  }
}

export class ViemBridgeAdapter implements BridgeContractPort {
  constructor(
    private readonly getClients: () => EvmClients | null,
    readonly address: string,
  ) {}

  async getFeePercentage(): Promise<string> {
    return asString(await this.read('getFeePercentage', []))
  }

  /**
   * A Hathor-origin transfer has no EVM block of its own, so the federation
   * hashes with `blockHash` in **both** the blockHash and transactionHash slots.
   * Building it any other way produces a hash that matches nothing on-chain, and
   * the transfer looks permanently unclaimed.
   */
  async getTransactionDataHash(request: ClaimRequest): Promise<string> {
    return asString(
      await this.read('getTransactionDataHash', [
        request.to,
        BigInt(request.amount),
        request.blockHash,
        request.blockHash,
        request.logIndex,
        BigInt(request.originChainId),
        BigInt(request.destinationChainId),
      ]),
    )
  }

  /**
   * Same duplication rule as getTransactionDataHash.
   *
   * `isClaimed` is **overloaded** in the ABI — the other variant takes the claim
   * tuple — and viem resolves the overload from the argument types. Two bytes32
   * hashes select this one; passing anything object-shaped would silently reach
   * the other.
   */
  async isClaimed(dataHash: string): Promise<boolean> {
    return Boolean(await this.read('isClaimed', [dataHash, dataHash]))
  }

  async claim(request: ClaimRequest, from: string, gasPrice: string): Promise<string> {
    return writeContract(
      this.clients(),
      ABIS.bridge,
      this.address,
      'claim',
      [
        {
          to: request.to,
          amount: BigInt(request.amount),
          blockHash: request.blockHash,
          transactionHash: request.blockHash,
          logIndex: request.logIndex,
          originChainId: BigInt(request.originChainId),
        },
      ],
      { from, gasPrice, gas: GAS.claim },
    )
  }

  async receiveTokensTo(
    params: {
      destinationChainId: number
      tokenAddress: string
      to: string
      amount: string
    },
    from: string,
    gasPrice: string,
  ): Promise<string> {
    return writeContract(
      this.clients(),
      ABIS.bridge,
      this.address,
      'receiveTokensTo',
      [BigInt(params.destinationChainId), params.tokenAddress, params.to, BigInt(params.amount)],
      { from, gasPrice, gas: GAS.receiveTokensTo },
    )
  }

  private read(fn: string, args: readonly unknown[]): Promise<unknown> {
    return readContract(this.clients(), ABIS.bridge, this.address, fn, args)
  }

  private clients(): EvmClients {
    return requireClients(this.getClients())
  }
}

export class ViemAllowTokensAdapter implements AllowTokensPort {
  constructor(
    private readonly getClients: () => EvmClients | null,
    private readonly address: string,
  ) {}

  /**
   * `getInfoAndLimits(address)` returns two tuples, `info` and `limit`, and the
   * limits are in the second one. Reading `min` off the top level — as this did
   * before it was wired to anything — yields undefined for all three, and
   * calling it without the address reverts outright.
   *
   * viem decodes multiple return values as an array, so `limit` is index 1; its
   * own components are named, so they arrive as an object.
   */
  async getInfoAndLimits(
    tokenAddress: string,
  ): Promise<{ min: string; max: string; daily: string }> {
    const result = await readContract(
      this.clients(),
      ABIS.allowTokens,
      this.address,
      'getInfoAndLimits',
      [tokenAddress],
    )
    const limit = (Array.isArray(result) ? result[1] : undefined) as
      Record<string, unknown> | undefined

    return {
      min: asString(limit?.['min']),
      max: asString(limit?.['max']),
      daily: asString(limit?.['daily']),
    }
  }

  async calcMaxWithdraw(tokenAddress: string): Promise<string> {
    return asString(
      await readContract(this.clients(), ABIS.allowTokens, this.address, 'calcMaxWithdraw', [
        tokenAddress,
      ]),
    )
  }

  private clients(): EvmClients {
    return requireClients(this.getClients())
  }
}

export class ViemFederationAdapter implements FederationPort {
  constructor(
    private readonly getClients: () => EvmClients | null,
    private readonly address: string,
  ) {}

  async getMembers(): Promise<string[]> {
    const members = await readContract(this.clients(), ABIS.federation, this.address, 'getMembers')
    return Array.isArray(members) ? members.map(asString) : []
  }

  private clients(): EvmClients {
    return requireClients(this.getClients())
  }
}
