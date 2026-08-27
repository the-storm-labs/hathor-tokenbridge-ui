import { describe, it, expect } from 'vitest'
import { messageOf } from './messages'

describe('messageOf', () => {
  it('reads the message off an Error', () => {
    expect(messageOf(new Error('boom'))).toBe('boom')
  })

  it('reads the message off a bare JSON-RPC error object, not just Error instances', () => {
    // What @walletconnect/jsonrpc-provider rejects with, and what an EIP-1193
    // wallet rejects a declined request with (MetaMask: code 4001).
    expect(messageOf({ code: 5000, message: 'User rejected.' })).toBe('User rejected.')
    expect(messageOf({ code: 4001, message: 'User rejected the request.' })).toBe(
      'User rejected the request.',
    )
  })

  it('falls back to String() for anything without a string message', () => {
    expect(messageOf('already a string')).toBe('already a string')
    expect(messageOf(null)).toBe('null')
    expect(messageOf(undefined)).toBe('undefined')
    expect(messageOf({ code: 5000 })).toBe('[object Object]')
    expect(messageOf({ message: 42 })).toBe('[object Object]')
  })
})
