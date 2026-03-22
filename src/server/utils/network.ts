import os from 'node:os'

export interface NetworkInterface {
  ip: string
  family: 'IPv4' | 'IPv6'
  name: string
}

export function getNetworkInterfaces(): NetworkInterface[] {
  const interfaces = os.networkInterfaces()
  const result: NetworkInterface[] = []

  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!addresses) continue

    for (const addr of addresses) {
      if (addr.family === 'IPv4') {
        result.push({
          ip: addr.address,
          family: 'IPv4',
          name,
        })
      }
    }
  }

  return result
}

export function getValidIPv4Addresses(): string[] {
  const interfaces = getNetworkInterfaces()
  
  // Filter out loopback and internal addresses
  const valid = interfaces
    .filter(addr => {
      // Exclude loopback
      if (addr.ip.startsWith('127.')) return false
      // Exclude link-local
      if (addr.ip.startsWith('169.254.')) return false
      // Exclude unique local addresses (fc00::/7 for IPv6, but we're only looking at IPv4)
      return true
    })
    .map(addr => addr.ip)

  // Sort: prefer eth*, wlan*, then others
  const sorted = valid.sort((a, b) => {
    const aInterface = interfaces.find(i => i.ip === a)?.name || ''
    const bInterface = interfaces.find(i => i.ip === b)?.name || ''
    
    // Prefer eth* interfaces
    if (aInterface.startsWith('eth') && !bInterface.startsWith('eth')) return -1
    if (!aInterface.startsWith('eth') && bInterface.startsWith('eth')) return 1
    
    // Then prefer wlan* interfaces
    if (aInterface.startsWith('wlan') && !bInterface.startsWith('wlan')) return -1
    if (!aInterface.startsWith('wlan') && bInterface.startsWith('wlan')) return 1
    
    return 0
  })

  return sorted
}

export function displayStartupBanner(config: {
  host: string
  port: number
  databasePath: string
  configPath: string
}): void {
  const { host, port, databasePath, configPath } = config
  const isLocalhost = host === '127.0.0.1'
  
  console.log('\n🦊 OpenFox v0.1.0\n')
  
  if (isLocalhost) {
    console.log(`  🌐 Server: http://localhost:${port}`)
    console.log('  🔒 Access: Localhost only')
  } else {
    const ips = getValidIPv4Addresses()
    
    if (ips.length === 0) {
      console.log(`  🌐 Server: http://0.0.0.0:${port}`)
      console.warn('  ⚠️  Warning: No valid network interfaces detected')
    } else {
      console.log('  🌐 Server:')
      for (const ip of ips) {
        console.log(`     • http://${ip}:${port}`)
      }
    }
    console.log('  🌍 Access: Local network')
  }
  
  console.log(`  💾 Database: ${databasePath}`)
  console.log(`  ⚙️  Config:  ${configPath}`)
  console.log('\n💡 Tip: Press Ctrl+C to stop the server\n')
}
