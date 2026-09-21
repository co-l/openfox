// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildOpenFoxMcpBootstrap } from './bootstrap.js'

describe('buildOpenFoxMcpBootstrap', () => {
  it('builds a ready-to-paste client config in local mode (no auth)', () => {
    const config = buildOpenFoxMcpBootstrap({
      host: '127.0.0.1',
      port: 10469,
      authRequired: false,
      sessionToken: null,
    })
    expect(config).toEqual({
      name: 'openfox',
      transport: 'http',
      url: 'http://127.0.0.1:10469/mcp',
    })
    expect(config.headers).toBeUndefined()
  })

  it('attaches the freshly computed token in network mode', () => {
    const config = buildOpenFoxMcpBootstrap({
      host: '10.0.0.5',
      port: 10369,
      authRequired: true,
      sessionToken: 'tok-123',
    })
    expect(config.url).toBe('http://10.0.0.5:10369/mcp')
    expect(config.headers).toEqual({ Authorization: 'Bearer tok-123' })
  })

  it('normalizes wildcard bind hosts to loopback', () => {
    const config = buildOpenFoxMcpBootstrap({
      host: '0.0.0.0',
      port: 10469,
      authRequired: false,
      sessionToken: null,
    })
    expect(config.url).toBe('http://127.0.0.1:10469/mcp')
  })

  it('refuses to emit a config when network mode lacks a token', () => {
    expect(() =>
      buildOpenFoxMcpBootstrap({
        host: '127.0.0.1',
        port: 10469,
        authRequired: true,
        sessionToken: null,
      }),
    ).toThrow(/token/i)
  })
})
