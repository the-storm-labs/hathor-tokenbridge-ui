/**
 * The four bridge contracts, as this app uses them.
 *
 * Grouped in one file because they are always constructed together, for one
 * network, and swapped together when the network changes.
 */

export interface Erc20Port {
  balanceOf(tokenAddress: string, owner: string): Promise<string>
  allowance(tokenAddress: string, owner: string, spender: string): Promise<string>
  /** @returns the transaction hash. */
  approve(
    tokenAddress: string,
    spender: string,
    amount: string,
    from: string,
    gasPrice: string,
  ): Promise<string>
}

/** Identifies a Hathor-origin transfer to the bridge contract. */
export interface ClaimRequest {
  readonly to: string
  /** Raw integer string, 18-decimal scaled. */
  readonly amount: string
  /**
   * For a Hathor-origin transfer this is `keccak256(hathorTxId)`, not an EVM
   * block hash — there is no EVM block of its own.
   */
  readonly blockHash: string
  readonly logIndex: number
  readonly originChainId: number
  readonly destinationChainId: number
}

export interface BridgeContractPort {
  getFeePercentage(): Promise<string>

  /**
   * The federation votes for a Hathor-origin transfer with **blockHash in both
   * the blockHash and transactionHash slots** — verified on-chain against
   * Arbitrum mainnet. The port takes a ClaimRequest with a single blockHash so
   * no caller can get the duplication wrong; the adapter passes it twice.
   */
  getTransactionDataHash(request: ClaimRequest): Promise<string>

  /** Whether a transfer has already been claimed. Pass the data hash twice. */
  isClaimed(dataHash: string): Promise<boolean>

  /** @returns the transaction hash. */
  claim(request: ClaimRequest, from: string, gasPrice: string): Promise<string>

  /** @returns the transaction hash. */
  receiveTokensTo(
    params: {
      readonly destinationChainId: number
      readonly tokenAddress: string
      readonly to: string
      readonly amount: string
    },
    from: string,
    gasPrice: string,
  ): Promise<string>

  readonly address: string
}

export interface AllowTokensPort {
  /**
   * The transfer limits for one token, in 18-decimal wei whatever the token's
   * own precision is.
   *
   * Per token, not global: the contract's signature takes an address, and the
   * limits are configured per token type.
   */
  getInfoAndLimits(tokenAddress: string): Promise<{ min: string; max: string; daily: string }>
  calcMaxWithdraw(tokenAddress: string): Promise<string>
}

export interface FederationPort {
  getMembers(): Promise<string[]>
}
