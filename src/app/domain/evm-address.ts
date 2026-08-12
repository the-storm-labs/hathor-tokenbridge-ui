/**
 * EVM destination address validation for the HTR→ARB form.
 *
 * Shape only — no EIP-55 checksum check, matching the current behaviour. A
 * checksum check would reject the all-lowercase addresses users routinely paste
 * from block explorers, so tightening it is a product decision, not a refactor.
 */

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

export function isEvmAddress(value: string | null | undefined): boolean {
  return !!value && EVM_ADDRESS_PATTERN.test(value)
}
