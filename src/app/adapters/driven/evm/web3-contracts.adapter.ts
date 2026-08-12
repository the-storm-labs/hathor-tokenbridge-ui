import type {
  AllowTokensPort,
  BridgeContractPort,
  ClaimRequest,
  Erc20Port,
  FederationPort,
} from '../../../ports/driven/contracts.port'
import { ABIS } from './abis'

/**
 * The bridge contracts over web3.js 1.x.
 *
 * This file is where web3's looseness is contained. Contract calls return
 * `unknown` because the ABI cannot tell web3 what comes back, and every result
 * is narrowed here — that containment is the point of the ports, not a
 * compromise around them.
 */

const asString = (value: unknown): string => (value == null ? '' : String(value))

/**
 * Submits a write and resolves as soon as the transaction has a hash.
 *
 * Awaiting `send()` instead would resolve on the *receipt*, which reads more
 * naturally but hides the hash until the transaction is mined — and the hash is
 * what the app needs to link to the explorer, to poll, and to report a revert
 * against. Waiting is the caller's decision (see confirmTransaction), which is
 * also what the ports promise: these methods return a transaction hash.
 */
function submit(method: Web3ContractMethod, options: SendOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const sent = method.send(options)

    sent.on('transactionHash', resolve)
    sent.on('error', reject)
    // A wallet that rejects before producing a hash rejects the promise itself,
    // and without this handler that becomes an unhandled rejection.
    sent.catch(reject)
  })
}

interface SendOptions {
  readonly from: string
  readonly gasPrice: string
  readonly gas: number
}

export class Web3Erc20Adapter implements Erc20Port {
  constructor(private readonly getWeb3: () => Web3Instance | null) {}

  async balanceOf(tokenAddress: string, owner: string): Promise<string> {
    return asString(await this.contract(tokenAddress).methods['balanceOf']!(owner).call())
  }

  async allowance(tokenAddress: string, owner: string, spender: string): Promise<string> {
    return asString(await this.contract(tokenAddress).methods['allowance']!(owner, spender).call())
  }

  async approve(
    tokenAddress: string,
    spender: string,
    amount: string,
    from: string,
    gasPrice: string,
  ): Promise<string> {
    return submit(this.contract(tokenAddress).methods['approve']!(spender, amount), {
      from,
      gasPrice,
      gas: 400_000,
    })
  }

  private contract(tokenAddress: string): Web3Contract {
    return new (requireWeb3(this.getWeb3()).eth.Contract)(ABIS.erc20, tokenAddress)
  }
}

export class Web3BridgeAdapter implements BridgeContractPort {
  constructor(
    private readonly getWeb3: () => Web3Instance | null,
    readonly address: string,
  ) {}

  async getFeePercentage(): Promise<string> {
    return asString(await this.contract().methods['getFeePercentage']!().call())
  }

  /**
   * A Hathor-origin transfer has no EVM block of its own, so the federation
   * hashes with `blockHash` in **both** the blockHash and transactionHash slots.
   * Building it any other way produces a hash that matches nothing on-chain, and
   * the transfer looks permanently unclaimed.
   */
  async getTransactionDataHash(request: ClaimRequest): Promise<string> {
    return asString(
      await this.contract().methods['getTransactionDataHash']!(
        request.to,
        request.amount,
        request.blockHash,
        request.blockHash,
        request.logIndex,
        request.originChainId,
        request.destinationChainId,
      ).call(),
    )
  }

  /** Same duplication rule as getTransactionDataHash. */
  async isClaimed(dataHash: string): Promise<boolean> {
    return Boolean(await this.contract().methods['isClaimed']!(dataHash, dataHash).call())
  }

  async claim(request: ClaimRequest, from: string, gasPrice: string): Promise<string> {
    return submit(
      this.contract().methods['claim']!({
        to: request.to,
        amount: request.amount,
        blockHash: request.blockHash,
        transactionHash: request.blockHash,
        logIndex: request.logIndex,
        originChainId: request.originChainId,
      }),
      { from, gasPrice, gas: 400_000 },
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
    return submit(
      this.contract().methods['receiveTokensTo']!(
        params.destinationChainId,
        params.tokenAddress,
        params.to,
        params.amount,
      ),
      { from, gasPrice, gas: 600_000 },
    )
  }

  private contract(): Web3Contract {
    return new (requireWeb3(this.getWeb3()).eth.Contract)(ABIS.bridge, this.address)
  }
}

export class Web3AllowTokensAdapter implements AllowTokensPort {
  constructor(
    private readonly getWeb3: () => Web3Instance | null,
    private readonly address: string,
  ) {}

  async getInfoAndLimits(): Promise<{ min: string; max: string; daily: string }> {
    const limits = (await this.contract().methods['getInfoAndLimits']!().call()) as
      | Record<string, unknown>
      | undefined

    return {
      min: asString(limits?.['min']),
      max: asString(limits?.['max']),
      daily: asString(limits?.['daily']),
    }
  }

  async calcMaxWithdraw(tokenAddress: string): Promise<string> {
    return asString(await this.contract().methods['calcMaxWithdraw']!(tokenAddress).call())
  }

  private contract(): Web3Contract {
    return new (requireWeb3(this.getWeb3()).eth.Contract)(ABIS.allowTokens, this.address)
  }
}

export class Web3FederationAdapter implements FederationPort {
  constructor(
    private readonly getWeb3: () => Web3Instance | null,
    private readonly address: string,
  ) {}

  async getMembers(): Promise<string[]> {
    const members = await this.contract().methods['getMembers']!().call()
    return Array.isArray(members) ? members.map(asString) : []
  }

  private contract(): Web3Contract {
    return new (requireWeb3(this.getWeb3()).eth.Contract)(ABIS.federation, this.address)
  }
}

function requireWeb3(web3: Web3Instance | null): Web3Instance {
  if (!web3) throw new Error('No EVM provider connected')
  return web3
}
