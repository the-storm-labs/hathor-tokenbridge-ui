import { describe, it, expect, vi } from 'vitest'
import { ViemEip7702Adapter, type CodeReader } from './eip7702-delegation.adapter'

const ADDRESS = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'
// 20 bytes, built rather than hand-counted so the fixture can't drift off the
// designator's exact length by a stray or missing zero.
const DELEGATE = `0x${'00'.repeat(19)}ad`

function fakeReader(getCode: CodeReader['getCode']): CodeReader {
  return { getCode }
}

describe('ViemEip7702Adapter', () => {
  it('returns the delegate address for a delegated account', async () => {
    const reader = fakeReader(async () => `0xef0100${DELEGATE.slice(2)}` as `0x${string}`)
    const adapter = new ViemEip7702Adapter(reader)

    expect(await adapter.getDelegate(ADDRESS)).toBe(DELEGATE)
  })

  it('returns null for a plain EOA (no code)', async () => {
    const reader = fakeReader(async () => undefined)
    const adapter = new ViemEip7702Adapter(reader)

    expect(await adapter.getDelegate(ADDRESS)).toBeNull()
  })

  it('returns null for a genuine contract, not a delegation', async () => {
    const reader = fakeReader(async () => '0x6080604052' as `0x${string}`)
    const adapter = new ViemEip7702Adapter(reader)

    expect(await adapter.getDelegate(ADDRESS)).toBeNull()
  })

  it('fails open — a read that throws resolves to null, not a rejection', async () => {
    const reader = fakeReader(async () => {
      throw new Error('RPC unreachable')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const adapter = new ViemEip7702Adapter(reader)

    await expect(adapter.getDelegate(ADDRESS)).resolves.toBeNull()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
