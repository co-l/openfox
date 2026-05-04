import os from 'node:os'
import { statSync } from 'node:fs'
import { VERSION } from '../../constants.js'

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
    .filter((addr) => {
      // Exclude loopback
      if (addr.ip.startsWith('127.')) return false
      // Exclude link-local
      if (addr.ip.startsWith('169.254.')) return false
      // Exclude unique local addresses (fc00::/7 for IPv6, but we're only looking at IPv4)
      return true
    })
    .map((addr) => addr.ip)

  // Sort: prefer eth*, wlan*, then others
  const sorted = valid.sort((a, b) => {
    const aInterface = interfaces.find((i) => i.ip === a)?.name || ''
    const bInterface = interfaces.find((i) => i.ip === b)?.name || ''

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

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0KB'

  const KB = 1024
  const MB = KB * 1024
  const GB = MB * 1024

  if (bytes >= GB) {
    return `${(bytes / GB).toFixed(1)}GB`
  } else if (bytes >= MB) {
    return `${(bytes / MB).toFixed(1)}MB`
  } else {
    return `${Math.round(bytes / KB)}KB`
  }
}

export function getDatabaseSize(databasePath: string): string {
  try {
    const stats = statSync(databasePath)
    return formatFileSize(stats.size)
  } catch {
    return '0KB'
  }
}

export function displayStartupBanner(config: {
  host: string
  port: number
  databasePath: string
  configPath: string
}): void {
  const { host, port, databasePath, configPath } = config
  const isLocalhost = host === '127.0.0.1'

  // eslint-disable-next-line no-console
  console.log(`\n🦊 OpenFox v${VERSION}\n`)

  if (isLocalhost) {
    // eslint-disable-next-line no-console
    console.log(`  🌐 Server: http://localhost:${port}`)
    // eslint-disable-next-line no-console
    console.log('  🔒 Access: Localhost only')
  } else {
    const ips = getValidIPv4Addresses()

    if (ips.length === 0) {
      // eslint-disable-next-line no-console
      console.log(`  🌐 Server: http://0.0.0.0:${port}`)

      console.warn('  ⚠️  Warning: No valid network interfaces detected')
    } else {
      // eslint-disable-next-line no-console
      console.log('  🌐 Server:')
      for (const ip of ips) {
        // eslint-disable-next-line no-console
        console.log(`     • http://${ip}:${port}`)
      }
      // eslint-disable-next-line no-console
      console.log('  🌍 Access: Local network')
    }
  }

  const size = getDatabaseSize(databasePath)
  // eslint-disable-next-line no-console
  console.log(`  💾 Database: ${databasePath} (${size})`)
  // eslint-disable-next-line no-console
  console.log(`  ⚙️  Config:  ${configPath}`)
  // eslint-disable-next-line no-console
  console.log('\n💡 Tip: Press Ctrl+C to stop the server\n')
}
