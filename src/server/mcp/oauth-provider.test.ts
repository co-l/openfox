import { describe, expect, it, afterEach } from 'vitest'
import { getMcpOAuthRedirectUri, setMcpOAuthServerPort } from './oauth-provider.js'

const ORIGINAL_PUBLIC_URL = process.env['OPENFOX_PUBLIC_URL']

describe('getMcpOAuthRedirectUri', () => {
  afterEach(() => {
    if (ORIGINAL_PUBLIC_URL === undefined) delete process.env['OPENFOX_PUBLIC_URL']
    else process.env['OPENFOX_PUBLIC_URL'] = ORIGINAL_PUBLIC_URL
    setMcpOAuthServerPort(10369)
  })

  it('defaults to a loopback URL on the current server port when OPENFOX_PUBLIC_URL is unset', () => {
    delete process.env['OPENFOX_PUBLIC_URL']
    setMcpOAuthServerPort(54321)

    expect(getMcpOAuthRedirectUri()).toBe('http://127.0.0.1:54321/api/mcp/oauth/callback')
  })

  it('uses OPENFOX_PUBLIC_URL as the origin when set', () => {
    process.env['OPENFOX_PUBLIC_URL'] = 'https://openfox.example.com'

    expect(getMcpOAuthRedirectUri()).toBe('https://openfox.example.com/api/mcp/oauth/callback')
  })

  it('keeps the prefix when OPENFOX_PUBLIC_URL points at a sub-path deployment', () => {
    process.env['OPENFOX_PUBLIC_URL'] = 'https://tunnel.example.com/openfox'

    expect(getMcpOAuthRedirectUri()).toBe('https://tunnel.example.com/openfox/api/mcp/oauth/callback')
  })

  it('does not double the separator when OPENFOX_PUBLIC_URL ends with a slash', () => {
    process.env['OPENFOX_PUBLIC_URL'] = 'https://tunnel.example.com/openfox/'

    expect(getMcpOAuthRedirectUri()).toBe('https://tunnel.example.com/openfox/api/mcp/oauth/callback')
  })

  it('drops a query string and a fragment carried by OPENFOX_PUBLIC_URL', () => {
    process.env['OPENFOX_PUBLIC_URL'] = 'https://openfox.example.com/?next=x#frag'

    expect(getMcpOAuthRedirectUri()).toBe('https://openfox.example.com/api/mcp/oauth/callback')
  })

  it('rejects a non http URL', () => {
    process.env['OPENFOX_PUBLIC_URL'] = 'javascript:alert(1)'

    expect(() => getMcpOAuthRedirectUri()).toThrow(/http or https/)
  })

  it('rejects a value that is not a URL at all', () => {
    process.env['OPENFOX_PUBLIC_URL'] = 'not a url'

    expect(() => getMcpOAuthRedirectUri()).toThrow(/not a valid URL/)
  })
})
