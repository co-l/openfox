import { execSync, spawn } from 'node:child_process'
import { join } from 'node:path'
import { readFile, writeFile, access, mkdir } from 'node:fs/promises'
import { platform } from 'node:os'
import { confirm, isCancel, cancel, log } from '@clack/prompts'
import type { Mode } from './main.js'
import { getGlobalConfigDir } from './paths.js'
import { cliT } from './i18n.js'

const PWA_CONFIG_FILE = 'pwa.json'

type PwaConfig = {
  appId: string
  profileId: string
  manifestUrl: string
  installedAt: string
}

function execSyncSilent(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }) as string
  } catch {
    return ''
  }
}

function execSyncOk(cmd: string): boolean {
  try {
    execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
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
    const out = execSync('firefoxpwa profile list', { encoding: 'utf-8', windowsHide: true }) as string
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

export async function isServerReachable(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/manifest.webmanifest`, {
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch {
    return false
  }
}

export function printPwaHelp(): void {
  console.log(
    cliT({
      en: `
PWA Commands (via Firefox PWAsForFirefox):

  openfox pwa           Start the PWA install walkthrough
  openfox pwa install   Install OpenFox as a desktop PWA
  openfox pwa uninstall Remove the OpenFox PWA from your system
  openfox pwa launch    Launch the OpenFox PWA
  openfox pwa update    Re-register the PWA (use after upgrading OpenFox)
  openfox pwa status    Check if the PWA is installed

Requirements:
  Install PWAsForFirefox first: https://pwasforfirefox.filips.si/installation/
`,
      fr: `
Commandes PWA (via Firefox PWAsForFirefox) :

  openfox pwa           Démarrer l’assistant d’installation PWA
  openfox pwa install   Installer OpenFox comme PWA de bureau
  openfox pwa uninstall Supprimer la PWA OpenFox de votre système
  openfox pwa launch    Lancer la PWA OpenFox
  openfox pwa update    Réenregistrer la PWA (après une mise à jour d’OpenFox)
  openfox pwa status    Vérifier si la PWA est installée

Prérequis :
  Installez d’abord PWAsForFirefox : https://pwasforfirefox.filips.si/installation/
`,
    }),
  )
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
    log.error(
      cliT({
        en: 'firefoxpwa is not installed or not on your PATH.',
        fr: 'firefoxpwa n’est pas installé ou absent de votre PATH.',
      }),
    )
    console.log(
      cliT({
        en: `\nInstall it first:\n\n  ${hint}\n\nSee: https://pwasforfirefox.filips.si/installation/`,
        fr: `\nInstallez-le d’abord :\n\n  ${hint}\n\nVoir : https://pwasforfirefox.filips.si/installation/`,
      }),
    )
    process.exit(1)
  }

  if (!isRuntimeInstalled()) {
    const install = await confirm({
      message: cliT({
        en: 'Firefox PWA runtime is not installed. Install it now?',
        fr: 'Le runtime Firefox PWA n’est pas installé. L’installer maintenant ?',
      }),
      initialValue: true,
    })
    if (isCancel(install)) {
      cancel()
      process.exit(0)
    }
    if (install) {
      log.info(cliT({ en: 'Running: firefoxpwa runtime install', fr: 'Exécution : firefoxpwa runtime install' }))
      try {
        spawn('firefoxpwa', ['runtime', 'install'], { stdio: 'inherit', windowsHide: true })
      } catch {
        log.error(cliT({ en: 'Failed to install runtime.', fr: 'Échec de l’installation du runtime.' }))
        process.exit(1)
      }
    } else {
      log.info(
        cliT({
          en: 'Skipping runtime install. The PWA cannot be used until the runtime is installed.',
          fr: 'Installation du runtime ignorée. La PWA ne pourra pas être utilisée tant que le runtime n’est pas installé.',
        }),
      )
      process.exit(0)
    }
  }

  const port = mode === 'development' ? 10469 : 10369
  if (!(await isServerReachable(port))) {
    log.error(
      cliT({
        en: `OpenFox server is not reachable on port ${port}.`,
        fr: `Le serveur OpenFox est injoignable sur le port ${port}.`,
      }),
    )
    console.log(
      cliT({ en: `\nStart OpenFox first:\n\n  openfox\n`, fr: `\nDémarrez d’abord OpenFox :\n\n  openfox\n` }),
    )
    process.exit(1)
  }

  const existing = await loadPwaConfig(mode)
  if (existing) {
    const installed = probeInstalledApp(manifestUrl)
    if (installed) {
      log.info(cliT({ en: 'OpenFox PWA is already installed.', fr: 'La PWA OpenFox est déjà installée.' }))
      console.log(cliT({ en: `  App ID:    ${installed.appId}`, fr: `  ID de l’app :    ${installed.appId}` }))
      console.log(cliT({ en: `  Profile:   ${installed.profileId}`, fr: `  Profil :   ${installed.profileId}` }))
      console.log(cliT({ en: `  URL:       ${manifestUrl}`, fr: `  URL :       ${manifestUrl}` }))
      console.log(
        cliT({
          en: `\nUse "openfox pwa launch" to start it, or "openfox pwa uninstall" to remove it.`,
          fr: `\nUtilisez « openfox pwa launch » pour la lancer, ou « openfox pwa uninstall » pour la supprimer.`,
        }),
      )
      return
    }
  }

  if (existing) {
    await removePwaConfig(mode)
  }

  log.info(cliT({ en: 'Installing OpenFox PWA...', fr: 'Installation de la PWA OpenFox...' }))

  let appId = ''
  let profileId = '00000000000000000000000000'
  try {
    execSync(`firefoxpwa site install ${manifestUrl}`, { encoding: 'utf-8', windowsHide: true })
    const detected = probeInstalledApp(manifestUrl)
    if (detected) {
      appId = detected.appId
      profileId = detected.profileId
    }
  } catch {
    log.error(
      cliT({
        en: 'Failed to install PWA. Ensure OpenFox is running and try again.',
        fr: 'Échec de l’installation de la PWA. Assurez-vous qu’OpenFox tourne et réessayez.',
      }),
    )
    process.exit(1)
  }

  if (!appId) {
    log.error(
      cliT({
        en: 'Could not detect installed app ID. The PWA may still be installed.',
        fr: 'Impossible de détecter l’ID de l’application installée. La PWA est peut-être quand même installée.',
      }),
    )
    console.log(cliT({ en: 'Check with: firefoxpwa profile list', fr: 'Vérifiez avec : firefoxpwa profile list' }))
    process.exit(1)
  }

  const pwaConfig: PwaConfig = { appId, profileId, manifestUrl, installedAt: new Date().toISOString() }
  await savePwaConfig(mode, pwaConfig)

  log.info(cliT({ en: 'OpenFox PWA installed successfully!', fr: 'PWA OpenFox installée avec succès !' }))
  console.log(cliT({ en: `\n  App ID:  ${appId}`, fr: `\n  ID de l’app :  ${appId}` }))
  console.log(cliT({ en: `  Profile: ${profileId}`, fr: `  Profil : ${profileId}` }))
  console.log(cliT({ en: `\nLaunch it with: openfox pwa launch`, fr: `\nLancez-la avec : openfox pwa launch` }))
}

async function pwaUninstall(mode: Mode): Promise<void> {
  if (!isFirefoxPwaAvailable()) {
    log.error(
      cliT({
        en: 'firefoxpwa is not installed or not on your PATH.',
        fr: 'firefoxpwa n’est pas installé ou absent de votre PATH.',
      }),
    )
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
    log.info(cliT({ en: 'OpenFox PWA is not installed.', fr: 'La PWA OpenFox n’est pas installée.' }))
    return
  }

  log.info(cliT({ en: 'Removing OpenFox PWA...', fr: 'Suppression de la PWA OpenFox...' }))
  try {
    execSync(`firefoxpwa site uninstall ${appId} --quiet`, { encoding: 'utf-8', windowsHide: true })
  } catch {
    log.error(
      cliT({
        en: `Failed to uninstall PWA (ID: ${appId}).`,
        fr: `Échec de la désinstallation de la PWA (ID : ${appId}).`,
      }),
    )
    process.exit(1)
  }

  await removePwaConfig(mode)
  log.info(cliT({ en: 'OpenFox PWA removed from your system.', fr: 'PWA OpenFox supprimée de votre système.' }))
  console.log(
    cliT({
      en: '\nNote: The Firefox PWA runtime is still installed.',
      fr: '\nRemarque : le runtime Firefox PWA est toujours installé.',
    }),
  )
  console.log(
    cliT({ en: 'To remove it: firefoxpwa runtime uninstall', fr: 'Pour le supprimer : firefoxpwa runtime uninstall' }),
  )
}

async function pwaLaunch(mode: Mode): Promise<void> {
  if (!isFirefoxPwaAvailable()) {
    log.error(
      cliT({
        en: 'firefoxpwa is not installed or not on your PATH.',
        fr: 'firefoxpwa n’est pas installé ou absent de votre PATH.',
      }),
    )
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
    log.info(cliT({ en: 'OpenFox PWA is not installed.', fr: 'La PWA OpenFox n’est pas installée.' }))
    console.log(
      cliT({ en: '\nInstall it first: openfox pwa install', fr: '\nInstallez-la d’abord : openfox pwa install' }),
    )
    return
  }

  log.info(cliT({ en: 'Launching OpenFox PWA...', fr: 'Lancement de la PWA OpenFox...' }))
  spawn('firefoxpwa', ['site', 'launch', appId], { stdio: 'inherit', windowsHide: true })
}

async function pwaUpdate(mode: Mode): Promise<void> {
  if (!isFirefoxPwaAvailable()) {
    log.error(
      cliT({
        en: 'firefoxpwa is not installed or not on your PATH.',
        fr: 'firefoxpwa n’est pas installé ou absent de votre PATH.',
      }),
    )
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
    log.info(cliT({ en: 'OpenFox PWA is not installed.', fr: 'La PWA OpenFox n’est pas installée.' }))
    console.log(
      cliT({ en: '\nInstall it first: openfox pwa install', fr: '\nInstallez-la d’abord : openfox pwa install' }),
    )
    return
  }

  try {
    execSync(`firefoxpwa site update ${appId}`, { encoding: 'utf-8', windowsHide: true })
  } catch {
    log.error(cliT({ en: 'Failed to update PWA metadata.', fr: 'Échec de la mise à jour des métadonnées PWA.' }))
    process.exit(1)
  }

  log.info(cliT({ en: 'OpenFox PWA metadata updated.', fr: 'Métadonnées PWA OpenFox mises à jour.' }))
  console.log(
    cliT({
      en: `\nThe manifest is re-fetched automatically on each launch.`,
      fr: `\nLe manifeste est re-téléchargé automatiquement à chaque lancement.`,
    }),
  )
  console.log(
    cliT({
      en: `Launch to pick up OpenFox changes:\n\n  openfox pwa launch`,
      fr: `Lancez la PWA pour appliquer les changements d’OpenFox :\n\n  openfox pwa launch`,
    }),
  )
}

async function pwaStatus(mode: Mode): Promise<void> {
  if (!isFirefoxPwaAvailable()) {
    log.error(
      cliT({
        en: 'firefoxpwa is not installed or not on your PATH.',
        fr: 'firefoxpwa n’est pas installé ou absent de votre PATH.',
      }),
    )
    console.log(
      cliT({
        en: '\nInstall PWAsForFirefox: https://pwasforfirefox.filips.si/installation/',
        fr: '\nInstallez PWAsForFirefox : https://pwasforfirefox.filips.si/installation/',
      }),
    )
    return
  }

  if (!isRuntimeInstalled()) {
    log.warn(cliT({ en: 'Firefox PWA runtime is not installed.', fr: 'Le runtime Firefox PWA n’est pas installé.' }))
    console.log(cliT({ en: `\nRun: firefoxpwa runtime install`, fr: `\nExécutez : firefoxpwa runtime install` }))
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
    log.info(cliT({ en: 'OpenFox PWA is not installed.', fr: 'La PWA OpenFox n’est pas installée.' }))
    console.log(cliT({ en: '\nInstall it: openfox pwa install', fr: '\nInstallez-la : openfox pwa install' }))
    return
  }

  log.info(cliT({ en: 'OpenFox PWA is installed.', fr: 'La PWA OpenFox est installée.' }))
  console.log(cliT({ en: `\n  App ID:      ${appId}`, fr: `\n  ID de l’app :      ${appId}` }))
  console.log(
    cliT({
      en: `  Profile ID:  ${existing?.profileId ?? 'default'}`,
      fr: `  ID du profil :  ${existing?.profileId ?? 'default'}`,
    }),
  )
  console.log(cliT({ en: `  Manifest:    ${manifestUrl}`, fr: `  Manifeste :    ${manifestUrl}` }))
  console.log(
    cliT({
      en: `  Installed:   ${existing?.installedAt ? new Date(existing.installedAt).toLocaleString() : 'unknown'}`,
      fr: `  Installée le :   ${existing?.installedAt ? new Date(existing.installedAt).toLocaleString() : 'inconnu'}`,
    }),
  )
}
