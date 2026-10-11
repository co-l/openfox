import { describe, it, expect } from 'vitest'
import { validatePublicUrl, validatePublicUrlSync } from './url-security.js'

describe('validatePublicUrlSync', () => {
  it('should allow public URLs', () => {
    expect(validatePublicUrlSync('https://example.com').valid).toBe(true)
    expect(validatePublicUrlSync('https://github.com/co-l/openfox').valid).toBe(true)
    expect(validatePublicUrlSync('http://8.8.8.8/dns-query').valid).toBe(true)
    expect(validatePublicUrlSync('https://1.1.1.1').valid).toBe(true)
  })

  it('should reject non-http(s) protocols', () => {
    expect(validatePublicUrlSync('file:///etc/passwd').valid).toBe(false)
    expect(validatePublicUrlSync('ftp://example.com').valid).toBe(false)
    expect(validatePublicUrlSync('javascript:alert(1)').valid).toBe(false)
    expect(validatePublicUrlSync('data:text/html,<script>alert(1)</script>').valid).toBe(false)
  })

  it('should reject invalid URLs', () => {
    expect(validatePublicUrlSync('not a url').valid).toBe(false)
    expect(validatePublicUrlSync('').valid).toBe(false)
  })

  it('should block localhost', () => {
    expect(validatePublicUrlSync('http://localhost').valid).toBe(false)
    expect(validatePublicUrlSync('http://localhost:8080').valid).toBe(false)
    expect(validatePublicUrlSync('http://foo.localhost').valid).toBe(false)
    expect(validatePublicUrlSync('http://ip6-localhost').valid).toBe(false)
  })

  it('should block loopback IPs', () => {
    expect(validatePublicUrlSync('http://127.0.0.1').valid).toBe(false)
    expect(validatePublicUrlSync('http://127.0.0.1:10369').valid).toBe(false)
    expect(validatePublicUrlSync('http://127.1.2.3').valid).toBe(false)
  })

  it('should block private IPv4 ranges', () => {
    expect(validatePublicUrlSync('http://10.0.0.1').valid).toBe(false)
    expect(validatePublicUrlSync('http://10.255.255.255').valid).toBe(false)
    expect(validatePublicUrlSync('http://172.16.0.1').valid).toBe(false)
    expect(validatePublicUrlSync('http://172.31.255.255').valid).toBe(false)
    expect(validatePublicUrlSync('http://192.168.0.1').valid).toBe(false)
    expect(validatePublicUrlSync('http://192.168.1.1').valid).toBe(false)
  })

  it('should block link-local (cloud metadata)', () => {
    expect(validatePublicUrlSync('http://169.254.169.254/latest/meta-data').valid).toBe(false)
    expect(validatePublicUrlSync('http://169.254.0.1').valid).toBe(false)
  })

  it('should block 0.0.0.0', () => {
    expect(validatePublicUrlSync('http://0.0.0.0').valid).toBe(false)
    expect(validatePublicUrlSync('http://0.0.0.0:8080').valid).toBe(false)
  })

  it('should block IPv6 loopback and private', () => {
    expect(validatePublicUrlSync('http://[::1]').valid).toBe(false)
    expect(validatePublicUrlSync('http://[::]').valid).toBe(false)
    expect(validatePublicUrlSync('http://[fc00::1]').valid).toBe(false)
    expect(validatePublicUrlSync('http://[fd00::1]').valid).toBe(false)
    expect(validatePublicUrlSync('http://[fe80::1]').valid).toBe(false)
  })

  it('should block IPv4-mapped IPv6 addresses', () => {
    expect(validatePublicUrlSync('http://[::ffff:127.0.0.1]').valid).toBe(false)
    expect(validatePublicUrlSync('http://[::ffff:10.0.0.1]').valid).toBe(false)
    expect(validatePublicUrlSync('http://[::ffff:169.254.169.254]').valid).toBe(false)
  })

  it('should block internal hostnames', () => {
    expect(validatePublicUrlSync('http://my-service.internal').valid).toBe(false)
    expect(validatePublicUrlSync('http://printer.local').valid).toBe(false)
    expect(validatePublicUrlSync('http://nas.lan').valid).toBe(false)
    expect(validatePublicUrlSync('http://router.home').valid).toBe(false)
    expect(validatePublicUrlSync('http://dc.corp').valid).toBe(false)
  })

  it('should allow public IPv6 addresses', () => {
    expect(validatePublicUrlSync('http://[2606:4700:4700::1111]').valid).toBe(true)
  })

  it('should block CGNAT range', () => {
    expect(validatePublicUrlSync('http://100.64.0.1').valid).toBe(false)
    expect(validatePublicUrlSync('http://100.127.255.255').valid).toBe(false)
  })

  it('should block multicast and reserved ranges', () => {
    expect(validatePublicUrlSync('http://224.0.0.1').valid).toBe(false)
    expect(validatePublicUrlSync('http://240.0.0.1').valid).toBe(false)
    expect(validatePublicUrlSync('http://255.255.255.255').valid).toBe(false)
  })
})

describe('validatePublicUrl (async)', () => {
  it('should allow public URLs', async () => {
    const result = await validatePublicUrl('https://example.com')
    expect(result.valid).toBe(true)
  })

  it('should reject non-http(s) protocols', async () => {
    const result = await validatePublicUrl('file:///etc/passwd')
    expect(result.valid).toBe(false)
  })

  it('should block localhost', async () => {
    const result = await validatePublicUrl('http://localhost:8080')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('localhost')
  })

  it('should block private IPs without DNS lookup', async () => {
    const result = await validatePublicUrl('http://192.168.1.1')
    expect(result.valid).toBe(false)
  })

  it('should block unresolvable hostnames', async () => {
    const result = await validatePublicUrl('http://this-domain-should-not-exist-xyz123.invalid')
    expect(result.valid).toBe(false)
  })
})
