import { execSync, spawn } from 'node:child_process'
import { join } from 'node:path'
import { readFile, writeFile, access, mkdir } from 'node:fs/promises'
import { platform } from 'node:os'
import { confirm, isCancel, cancel, log } from '@clack/prompts'
import type { Mode } from './main.js'
import { getGlobalConfigDir } from './paths.js'

const PWA_CONFIG_FILE = 'pwa.json'

type PwaConfig = {
  appId: string
  profileId: string
  manifestUrl: string
  installedAt: string
}

function execSyncSilent(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }) as string
  } catch {
    return ''
  }
}

function execSyncOk(cmd: string): boolean {
  try {
    execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    return true
  } catch {
    return false
  }
}

function isFirefoxPwaAvailable(): boolean {
  if (platform() === 'win32') {
    return execSyncOk('where firefoxpwa')
  }
  return execSyncOk('which firefoxpwa')
}

function isRuntimeInstalled(): boolean {
  const out = execSyncSilent('firefoxpwa runtime --help')
  return out.includes('uninstall')
}

export function getManifestUrl(mode: Mode): string {
  const port = mode === 'development' ? 10469 : 10369
  return `http://127.0.0.1:${port}/manifest.webmanifest`
}

function getPwaConfigPath(mode: Mode): string {
  return join(getGlobalConfigDir(mode), PWA_CONFIG_FILE)
}

export async function loadPwaConfig(mode: Mode): Promise<PwaConfig | null> {
  try {
    const content = await readFile(getPwaConfigPath(mode), 'utf-8')
    return JSON.parse(content) as PwaConfig
  } catch {
    return null
  }
}

export async function savePwaConfig(mode: Mode, config: PwaConfig): Promise<void> {
  await mkdir(getGlobalConfigDir(mode), { recursive: true })
  await writeFile(getPwaConfigPath(mode), JSON.stringify(config, null, 2))
}

export async function removePwaConfig(mode: Mode): Promise<void> {
  try {
    await access(getPwaConfigPath(mode))
  } catch {
    return
  }
  const { unlink } = await import('node:fs/promises')
  await unlink(getPwaConfigPath(mode))
}

function getFirefoxPwaInstallHint(): string {
  const plat = platform()
  switch (plat) {
    case 'darwin':
      return 'brew install firefoxpwa'
    case 'win32':
      return 'scoop install extras/firefoxpwa   # or: choco install firefoxpwa   # or: winget install filips.FirefoxPWA'
    case 'linux':
      if (execSyncOk('which apt-get')) return 'apt install firefoxpwa        # Debian/Ubuntu'
      if (execSyncOk('which dnf')) return 'dnf install firefoxpwa        # Fedora/RHEL'
      if (execSyncOk('which pacman')) return 'pacman -S firefoxpwa          # Arch'
      return 'See: https://pwasforfirefox.filips.si/installation/'
    default:
      return 'See: https://pwasforfirefox.filips.si/installation/'
  }
}

function probeInstalledApp(manifestUrl: string): { appId: string; profileId: string } | null {
  try {
    const out = execSync('firefoxpwa profile list', { encoding: 'utf-8' }) as string
    const lines = out.split('\n')
    let currentProfile = ''
    for (const line of lines) {
      const idMatch = line.match(/^ID:\s+(\S+)/)
      if (idMatch) {
        currentProfile = idMatch[1]!
        continue
      }
      const appMatch = line.match(/-\s+\S+:\s+(\S+)\s+\((\S+)\)/)
      if (appMatch && currentProfile) {
        if (appMatch[1] === manifestUrl) {
          return { appId: appMatch[2]!, profileId: currentProfile }
        }
      }
    }
  } catch {
    // silent
  }
  return null
}

function isServerReachable(port: number): boolean {
  try {
    const result = execSync(`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${port}/manifest.webmanifest`, {
      encoding: 'utf-8',
      timeout: 5000,
    }) as string
    return result.trim() === '200'
  } catch {
    return false
  }
}

export function printPwaHelp(): void {
  console.log(`
PWA Commands (via Firefox PWAsForFirefox):

  openfox pwa           Start the PWA install walkthrough
  openfox pwa install   Install OpenFox as a desktop PWA
  openfox pwa uninstall Remove the OpenFox PWA from your system
  openfox pwa launch    Launch the OpenFox PWA
  openfox pwa update    Re-register the PWA (use after upgrading OpenFox)
  openfox pwa status    Check if the PWA is installed

Requirements:
  Install PWAsForFirefox first: https://pwasforfirefox.filips.si/installation/
`)
}

export async function runPwaCommand(mode: Mode, subcommand?: string): Promise<void> {
  switch (subcommand) {
    case 'install':
    case undefined:
      await pwaInstall(mode)
      break
    case 'uninstall':
      await pwaUninstall(mode)
      break
    case 'launch':
      await pwaLaunch(mode)
      break
    case 'update':
      await pwaUpdate(mode)
      break
    case 'status':
      await pwaStatus(mode)
      break
    default:
      printPwaHelp()
  }
}

async function pwaInstall(mode: Mode): Promise<void> {
  const manifestUrl = getManifestUrl(mode)

  if (!isFirefoxPwaAvailable()) {
    const hint = getFirefoxPwaInstallHint()
    log.error('firefoxpwa is not installed or not on your PATH.')
    console.log(`\nInstall it first:\n\n  ${hint}\n\nSee: https://pwasforfirefox.filips.si/installation/`)
    process.exit(1)
  }

  if (!isRuntimeInstalled()) {
    const install = await confirm({
      message: 'Firefox PWA runtime is not installed. Install it now?',
      initialValue: true,
    })
    if (isCancel(install)) {
      cancel()
      process.exit(0)
    }
    if (install) {
      log.info('Running: firefoxpwa runtime install')
      try {
        spawn('firefoxpwa', ['runtime', 'install'], { stdio: 'inherit' })
      } catch {
        log.error('Failed to install runtime.')
        process.exit(1)
      }
    } else {
      log.info('Skipping runtime install. The PWA cannot be used until the runtime is installed.')
      process.exit(0)
    }
  }

  const port = mode === 'development' ? 10469 : 10369
  if (!isServerReachable(port)) {
    log.error(`OpenFox server is not reachable on port ${port}.`)
    console.log(`\nStart OpenFox first:\n\n  openfox\n`)
    process.exit(1)
  }

  const existing = await loadPwaConfig(mode)
  if (existing) {
    const installed = probeInstalledApp(manifestUrl)
    if (installed) {
      log.info('OpenFox PWA is already installed.')
      console.log(`  App ID:    ${installed.appId}`)
      console.log(`  Profile:   ${installed.profileId}`)
      console.log(`  URL:       ${manifestUrl}`)
      console.log(`\nUse "openfox pwa launch" to start it, or "openfox pwa uninstall" to remove it.`)
      return
    }
  }

  if (existing) {
    await removePwaConfig(mode)
  }

  log.info('Installing OpenFox PWA...')

  let appId = ''
  let profileId = '00000000000000000000000000'
  try {
    execSync(`firefoxpwa site install ${manifestUrl}`, { encoding: 'utf-8' })
    const detected = probeInstalledApp(manifestUrl)
    if (detected) {
      appId = detected.appId
      profileId = detected.profileId
    }
  } catch {
    log.error('Failed to install PWA. Ensure OpenFox is running and try again.')
    process.exit(1)
  }

  if (!appId) {
    log.error('Could not detect installed app ID. The PWA may still be installed.')
    console.log('Check with: firefoxpwa profile list')
    process.exit(1)
  }

  const pwaConfig: PwaConfig = { appId, profileId, manifestUrl, installedAt: new Date().toISOString() }
  await savePwaConfig(mode, pwaConfig)

  log.info('OpenFox PWA installed successfully!')
  console.log(`\n  App ID:  ${appId}`)
  console.log(`  Profile: ${profileId}`)
  console.log(`\nLaunch it with: openfox pwa launch`)
}

async function pwaUninstall(mode: Mode): Promise<void> {
  if (!isFirefoxPwaAvailable()) {
    log.error('firefoxpwa is not installed or not on your PATH.')
    process.exit(1)
  }

  const manifestUrl = getManifestUrl(mode)
  const existing = await loadPwaConfig(mode)
  let appId = existing?.appId ?? ''

  if (!appId) {
    const detected = probeInstalledApp(manifestUrl)
    if (detected) appId = detected.appId
  }

  if (!appId) {
    log.info('OpenFox PWA is not installed.')
    return
  }

  log.info('Removing OpenFox PWA...')
  try {
    execSync(`firefoxpwa site uninstall ${appId} --quiet`, { encoding: 'utf-8' })
  } catch {
    log.error(`Failed to uninstall PWA (ID: ${appId}).`)
    process.exit(1)
  }

  await removePwaConfig(mode)
  log.info('OpenFox PWA removed from your system.')
  console.log('\nNote: The Firefox PWA runtime is still installed.')
  console.log('To remove it: firefoxpwa runtime uninstall')
}

async function pwaLaunch(mode: Mode): Promise<void> {
  if (!isFirefoxPwaAvailable()) {
    log.error('firefoxpwa is not installed or not on your PATH.')
    process.exit(1)
  }

  const manifestUrl = getManifestUrl(mode)
  const existing = await loadPwaConfig(mode)
  let appId = existing?.appId ?? ''

  if (!appId) {
    const detected = probeInstalledApp(manifestUrl)
    if (detected) appId = detected.appId
  }

  if (!appId) {
    log.info('OpenFox PWA is not installed.')
    console.log('\nInstall it first: openfox pwa install')
    return
  }

  log.info('Launching OpenFox PWA...')
  spawn('firefoxpwa', ['site', 'launch', appId], { stdio: 'inherit' })
}

async function pwaUpdate(mode: Mode): Promise<void> {
  if (!isFirefoxPwaAvailable()) {
    log.error('firefoxpwa is not installed or not on your PATH.')
    process.exit(1)
  }

  const manifestUrl = getManifestUrl(mode)
  const existing = await loadPwaConfig(mode)
  let appId = existing?.appId ?? ''

  if (!appId) {
    const detected = probeInstalledApp(manifestUrl)
    if (detected) appId = detected.appId
  }

  if (!appId) {
    log.info('OpenFox PWA is not installed.')
    console.log('\nInstall it first: openfox pwa install')
    return
  }

  try {
    execSync(`firefoxpwa site update ${appId}`, { encoding: 'utf-8' })
  } catch {
    log.error('Failed to update PWA metadata.')
    process.exit(1)
  }

  log.info('OpenFox PWA metadata updated.')
  console.log(`\nThe manifest is re-fetched automatically on each launch.`)
  console.log(`Launch to pick up OpenFox changes:\n\n  openfox pwa launch`)
}

async function pwaStatus(mode: Mode): Promise<void> {
  if (!isFirefoxPwaAvailable()) {
    log.error('firefoxpwa is not installed or not on your PATH.')
    console.log('\nInstall PWAsForFirefox: https://pwasforfirefox.filips.si/installation/')
    return
  }

  if (!isRuntimeInstalled()) {
    log.warn('Firefox PWA runtime is not installed.')
    console.log(`\nRun: firefoxpwa runtime install`)
    return
  }

  const manifestUrl = getManifestUrl(mode)
  const existing = await loadPwaConfig(mode)
  let appId = existing?.appId ?? ''

  if (!appId) {
    const detected = probeInstalledApp(manifestUrl)
    if (detected) appId = detected.appId
  }

  if (!appId) {
    log.info('OpenFox PWA is not installed.')
    console.log('\nInstall it: openfox pwa install')
    return
  }

  log.info('OpenFox PWA is installed.')
  console.log(`\n  App ID:      ${appId}`)
  console.log(`  Profile ID:  ${existing?.profileId ?? 'default'}`)
  console.log(`  Manifest:    ${manifestUrl}`)
  console.log(`  Installed:   ${existing?.installedAt ? new Date(existing.installedAt).toLocaleString() : 'unknown'}`)
}
