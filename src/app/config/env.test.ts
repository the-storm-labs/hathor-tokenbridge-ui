import { describe, it, expect } from 'vitest'
import { resolveDeployment } from './env'

const fakeLocation = (url: string) => new URL(url) as unknown as Location
const fakeDocument = (deployment?: string) =>
  ({ documentElement: { dataset: deployment ? { deployment } : {} } }) as unknown as Document

describe('resolveDeployment', () => {
  it('defaults to mainnet', () => {
    expect(resolveDeployment(fakeLocation('https://hathorbridge.xyz/'), fakeDocument())).toBe(
      'mainnet',
    )
  })

  it('honours the ?testnet query param', () => {
    // The footer link points at ./index.html?testnet — a supported entry point.
    expect(
      resolveDeployment(fakeLocation('https://hathorbridge.xyz/index.html?testnet'), fakeDocument()),
    ).toBe('testnet')
  })

  it('lets the query param win over the document attribute', () => {
    expect(
      resolveDeployment(
        fakeLocation('https://hathorbridge.xyz/index.html?testnet'),
        fakeDocument('mainnet'),
      ),
    ).toBe('testnet')
  })

  it('reads the document attribute', () => {
    expect(resolveDeployment(fakeLocation('https://x.dev/'), fakeDocument('testnet'))).toBe(
      'testnet',
    )
    expect(resolveDeployment(fakeLocation('https://x.dev/'), fakeDocument('mainnet'))).toBe(
      'mainnet',
    )
  })

  it('ignores an unrecognised attribute value', () => {
    expect(resolveDeployment(fakeLocation('https://x.dev/'), fakeDocument('staging'))).toBe(
      'mainnet',
    )
  })

  it('falls back to the testnet.html filename', () => {
    expect(
      resolveDeployment(fakeLocation('https://hathorbridge.xyz/testnet.html'), fakeDocument()),
    ).toBe('testnet')
  })

  it('does NOT match the word testnet elsewhere in the URL', () => {
    // The old check was `location.href.includes('testnet')`, so a host, path or
    // fragment containing the word silently flipped the whole app to testnet
    // config — including which contract addresses it used.
    expect(
      resolveDeployment(fakeLocation('https://testnet-preview.web.app/'), fakeDocument()),
    ).toBe('mainnet')
    expect(
      resolveDeployment(fakeLocation('https://hathorbridge.xyz/docs/testnet/guide'), fakeDocument()),
    ).toBe('mainnet')
    expect(
      resolveDeployment(fakeLocation('https://hathorbridge.xyz/#testnet'), fakeDocument()),
    ).toBe('mainnet')
  })
})
