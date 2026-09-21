import { spawn, spawnSync } from 'node:child_process'
import { mkdir, writeFile, rm, access, constants } from 'node:fs/promises'

import { join } from 'node:path'
import { homedir } from 'node:os'
import { cliT } from './i18n.js'

const RUN_SCRIPT_PATH = '~/.local/state/openfox/bin/run.sh'
const SERVICE_PATH = '~/.config/systemd/user/openfox.service'
const SERVICE_NAME = 'openfox'

function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2))
  }
  return path
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(expandPath(path), constants.F_OK)
    return true
  } catch {
    return false
  }
}

function systemctl(args: string[], silent = false): { success: boolean; output: string } {
  const result = spawnSync('systemctl', ['--user', ...args], {
    encoding: 'utf-8',
    windowsHide: true,
  })
  if (!silent) {
    console.log(result.stdout || result.stderr || '')
  }
  return { success: result.status === 0, output: result.stdout + result.stderr }
}

function exec(command: string, args: string[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Command failed: ${command} ${args.join(' ')}`))
    })
    child.on('error', reject)
  })
}

const DISPLAY_POLLING_BLOCK = `
if [ -z "$DISPLAY" ] || [ -z "$WAYLAND_DISPLAY" ]; then
  for _ in 0 1 2 3 4; do
    if [ -z "$DISPLAY" ]; then
      xdisplay=$(
        ps aux --no-headers 2>/dev/null \\
          | grep -v grep \\
          | grep "Xwayland" \\
          | awk '{ for (i = 1; i <= NF; i++) if ($i ~ /^:[0-9]+$/) print $i }'
      )
      if [ -n "$xdisplay" ]; then
        export DISPLAY="$xdisplay"
        for f in "$HOME/.Xauthority" "\${XDG_RUNTIME_DIR}"/xauth_*; do
          [ -f "$f" ] && export XAUTHORITY="$f" && break
        done 2>/dev/null
      fi
    fi

    if [ -z "$WAYLAND_DISPLAY" ]; then
      socket="\${XDG_RUNTIME_DIR}/wayland-0"
      [ -e "$socket" ] || socket="\${XDG_RUNTIME_DIR}/wayland-1"
      [ -e "$socket" ] && export WAYLAND_DISPLAY="\${socket##*/}"
    fi

    [ -n "$DISPLAY" ] && [ -n "$WAYLAND_DISPLAY" ] && break
    sleep 2
  done
fi
`

export async function detectHeadless(): Promise<boolean> {
  if (process.env['DISPLAY'] || process.env['WAYLAND_DISPLAY']) {
    return false
  }

  try {
    await access('/tmp/.X11-unix/X0', constants.F_OK)
    return false
  } catch {
    // ignore
  }

  const runtimeDir = process.env['XDG_RUNTIME_DIR']
  if (runtimeDir) {
    try {
      await access(join(runtimeDir, 'wayland-0'), constants.F_OK)
      return false
    } catch {
      // ignore
    }
  }

  return true
}

async function createWrapperScript(headless: boolean): Promise<void> {
  const binDir = expandPath('~/.local/state/openfox/bin')
  await mkdir(binDir, { recursive: true })

  const scriptPath = expandPath(RUN_SCRIPT_PATH)
  const scriptContent = `#!/bin/bash
source ~/.profile 2>/dev/null || true
source ~/.bashrc 2>/dev/null || true
${headless ? '' : DISPLAY_POLLING_BLOCK}
# Find openfox - respect user's PATH, fallback to nvm search for non-interactive cases
if ! openfox_bin=$(which openfox 2>/dev/null); then
  openfox_bindir=""
  for NVMVER in "$HOME"'/versions/node/'*'/bin/'; do
    [ -f "$NVMVER"'openfox' ] && openfox_bindir="$NVMVER" && break
    [ -L "$NVMVER"'openfox' ] && openfox_bindir="$NVMVER" && break
  done
  if [ -n "$openfox_bindir" ]; then
    export PATH="$openfox_bindir:$PATH"
    openfox_bin=$(readlink -f "$openfox_bindir"'openfox')
  fi
fi

if [ -z "$openfox_bin" ]; then
  echo "openfox not found in PATH and no nvm install detected" >&2
  exit 1
fi

exec "$openfox_bin" "$@"
`
  await writeFile(scriptPath, scriptContent, { encoding: 'utf-8' })

  await exec('chmod', ['+x', scriptPath])
  console.log(cliT({ en: `Created: ${scriptPath}`, fr: `Créé : ${scriptPath}` }))
}

async function createSystemdService(headless: boolean): Promise<void> {
  const serviceDir = expandPath('~/.config/systemd/user')
  await mkdir(serviceDir, { recursive: true })

  const target = headless ? 'default.target' : 'graphical-session.target'
  const wants = headless ? '' : '\nWants=graphical-session.target'

  const servicePath = expandPath(SERVICE_PATH)
  const serviceContent = `[Unit]
Description=OpenFox Agentic Coding Assistant
After=${target}${wants}

[Service]
Type=simple
ExecStart=${expandPath(RUN_SCRIPT_PATH)}
Restart=always
RestartSec=5
KillMode=control-group
Environment=OPENFOX_SERVICE=true

[Install]
WantedBy=${target}
`
  await writeFile(servicePath, serviceContent, 'utf-8')
  console.log(cliT({ en: `Created: ${servicePath}`, fr: `Créé : ${servicePath}` }))
}

export async function runServiceCommand(_mode: Mode, subcommand?: string, ...args: string[]): Promise<void> {
  if (process.platform === 'win32') {
    console.log(
      cliT({
        en: 'openfox service is not supported on Windows (it relies on systemd). Run `openfox` directly instead.',
        fr: 'openfox service n’est pas pris en charge sur Windows (il repose sur systemd). Lancez `openfox` directement à la place.',
      }),
    )
    process.exitCode = 1
    return
  }
  if (!subcommand) {
    printServiceHelp()
    return
  }

  const headlessFlag = args.includes('--headless')
  const desktopFlag = args.includes('--desktop')

  switch (subcommand) {
    case 'install': {
      let headlessOverride: boolean | undefined
      if (headlessFlag && desktopFlag) {
        console.error(
          cliT({
            en: 'Cannot use both --headless and --desktop',
            fr: 'Impossible d’utiliser à la fois --headless et --desktop',
          }),
        )
        process.exit(1)
      } else if (headlessFlag) {
        headlessOverride = true
      } else if (desktopFlag) {
        headlessOverride = false
      }
      await serviceInstall(headlessOverride)
      break
    }
    case 'start':
      await serviceStart()
      break
    case 'stop':
      await serviceStop()
      break
    case 'restart':
      await serviceRestart()
      break
    case 'status':
      await serviceStatus()
      break
    case 'logs':
      await serviceLogs(args)
      break
    case 'uninstall':
      await serviceUninstall()
      break
    default:
      console.error(cliT({ en: `Unknown subcommand: ${subcommand}`, fr: `Sous-commande inconnue : ${subcommand}` }))
      printServiceHelp()
      process.exit(1)
  }
}

function printServiceHelp(): void {
  console.log(
    cliT({
      en: `
OpenFox Service Management

Usage:
  openfox service <command>

Commands:
  install    Install and enable the systemd service
             Use --headless for headless/CLI-only servers
             Use --desktop to force desktop mode (default when display detected)
  start      Start the service (if installed)
  stop       Stop the service (if installed)
  restart    Restart the service (if installed)
  status     Show service status
  logs [-f]  Show recent service logs (use -f or --follow to tail)
  uninstall  Disable and remove the service files
`,
      fr: `
Gestion du service OpenFox

Utilisation :
  openfox service <commande>

Commandes :
  install    Installer et activer le service systemd
             Utiliser --headless pour les serveurs sans affichage / CLI uniquement
             Utiliser --desktop pour forcer le mode bureau (défaut quand un affichage est détecté)
  start      Démarrer le service (s’il est installé)
  stop       Arrêter le service (s’il est installé)
  restart    Redémarrer le service (s’il est installé)
  status     Afficher l’état du service
  logs [-f]  Afficher les journaux récents du service (utiliser -f ou --follow pour suivre)
  uninstall  Désactiver et supprimer les fichiers du service
`,
    }),
  )
}

async function serviceInstall(headlessOverride?: boolean): Promise<void> {
  const headless = headlessOverride ?? (await detectHeadless())

  if (headless) {
    console.log(
      cliT({
        en: 'Installing OpenFox service (headless mode)...\n',
        fr: 'Installation du service OpenFox (mode sans affichage)...\n',
      }),
    )
  } else {
    console.log(
      cliT({
        en: 'Installing OpenFox service (desktop mode)...\n',
        fr: 'Installation du service OpenFox (mode bureau)...\n',
      }),
    )
    console.log(
      cliT({
        en: '  Tip: Use --headless for headless/CLI-only servers',
        fr: '  Astuce : utilisez --headless pour les serveurs sans affichage / CLI uniquement',
      }),
    )
  }

  const installed = await pathExists(SERVICE_PATH)
  if (installed) {
    const { success } = systemctl(['is-active', SERVICE_NAME], true)
    if (success) {
      console.log(
        cliT({
          en: 'Service is already installed and running.',
          fr: 'Le service est déjà installé et en cours d’exécution.',
        }),
      )
      return
    }
    console.log(
      cliT({ en: 'Service files exist. Reinstalling...', fr: 'Les fichiers du service existent. Réinstallation...' }),
    )
    await serviceUninstall()
  }

  await createWrapperScript(headless)
  await createSystemdService(headless)

  systemctl(['daemon-reload'])
  systemctl(['enable', SERVICE_NAME])
  systemctl(['start', SERVICE_NAME])

  console.log(cliT({ en: '\n✓ Service installed and started', fr: '\n✓ Service installé et démarré' }))
}

async function serviceStart(): Promise<void> {
  const installed = await pathExists(SERVICE_PATH)
  if (!installed) {
    console.log(
      cliT({
        en: 'Service not installed. Run "openfox service install" first.',
        fr: 'Service non installé. Lancez d’abord « openfox service install ».',
      }),
    )
    return
  }

  const { success } = systemctl(['is-active', SERVICE_NAME], true)
  if (success) {
    console.log(cliT({ en: 'Service is already running.', fr: 'Le service est déjà en cours d’exécution.' }))
    return
  }

  systemctl(['start', SERVICE_NAME])
  console.log(cliT({ en: '✓ Service started', fr: '✓ Service démarré' }))
}

async function serviceStop(): Promise<void> {
  const installed = await pathExists(SERVICE_PATH)
  if (!installed) {
    console.log(cliT({ en: 'Service not installed.', fr: 'Service non installé.' }))
    return
  }

  const { success } = systemctl(['is-active', SERVICE_NAME], true)
  if (!success) {
    console.log(cliT({ en: 'Service is not running.', fr: 'Le service n’est pas en cours d’exécution.' }))
    return
  }

  const { success: stopped } = systemctl(['stop', SERVICE_NAME])
  if (stopped) {
    console.log(cliT({ en: '✓ Service stopped', fr: '✓ Service arrêté' }))
  } else {
    console.error(cliT({ en: '✗ Failed to stop service', fr: '✗ Échec de l’arrêt du service' }))
    process.exit(1)
  }
}

async function serviceRestart(): Promise<void> {
  const installed = await pathExists(SERVICE_PATH)
  if (!installed) {
    console.log(cliT({ en: 'Service not installed.', fr: 'Service non installé.' }))
    return
  }

  systemctl(['restart', SERVICE_NAME])
  console.log(cliT({ en: '✓ Service restarted', fr: '✓ Service redémarré' }))
}

async function serviceStatus(): Promise<void> {
  const installed = await pathExists(SERVICE_PATH)
  if (!installed) {
    console.log(cliT({ en: 'Service: not installed', fr: 'Service : non installé' }))
    return
  }

  console.log(cliT({ en: 'Service: installed', fr: 'Service : installé' }))
  systemctl(['is-active', SERVICE_NAME], false)
  systemctl(['is-enabled', SERVICE_NAME], false)
}

async function serviceLogs(args: string[]): Promise<void> {
  const installed = await pathExists(SERVICE_PATH)
  if (!installed) {
    console.log(cliT({ en: 'Service not installed.', fr: 'Service non installé.' }))
    return
  }

  const follow = args.includes('-f') || args.includes('--follow')

  if (follow) {
    spawn('journalctl', ['--user', '-u', SERVICE_NAME, '-f', '--no-pager'], { stdio: 'inherit', windowsHide: true })
  } else {
    const result = spawnSync('journalctl', ['--user', '-u', SERVICE_NAME, '-n', '50', '--no-pager'], {
      encoding: 'utf-8',
      windowsHide: true,
    })
    console.log(result.stdout || result.stderr || cliT({ en: 'No logs', fr: 'Aucun journal' }))
  }
}

async function serviceUninstall(): Promise<void> {
  console.log(cliT({ en: 'Uninstalling OpenFox service...\n', fr: 'Désinstallation du service OpenFox...\n' }))

  const installed = await pathExists(SERVICE_PATH)
  if (!installed) {
    console.log(cliT({ en: 'Service not installed.', fr: 'Service non installé.' }))
    return
  }

  const { success } = systemctl(['is-active', SERVICE_NAME], true)
  if (success) {
    systemctl(['stop', SERVICE_NAME])
  }

  systemctl(['disable', SERVICE_NAME])

  try {
    await rm(expandPath(SERVICE_PATH))
    console.log(cliT({ en: `Removed: ${expandPath(SERVICE_PATH)}`, fr: `Supprimé : ${expandPath(SERVICE_PATH)}` }))
  } catch {
    // ignore
  }

  try {
    await rm(expandPath(RUN_SCRIPT_PATH))
    console.log(
      cliT({ en: `Removed: ${expandPath(RUN_SCRIPT_PATH)}`, fr: `Supprimé : ${expandPath(RUN_SCRIPT_PATH)}` }),
    )
  } catch {
    // ignore
  }

  systemctl(['daemon-reload'])

  console.log(cliT({ en: '\n✓ Service uninstalled', fr: '\n✓ Service désinstallé' }))
}

type Mode = 'production' | 'development' | 'test'
