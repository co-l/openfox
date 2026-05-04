import { spawn, spawnSync } from 'node:child_process'
import { mkdir, writeFile, rm, access, constants } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

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
  })
  if (!silent) {
    console.log(result.stdout || result.stderr || '')
  }
  return { success: result.status === 0, output: result.stdout + result.stderr }
}

function exec(command: string, args: string[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Command failed: ${command} ${args.join(' ')}`))
    })
    child.on('error', reject)
  })
}

async function createWrapperScript(): Promise<void> {
  const binDir = expandPath('~/.local/state/openfox/bin')
  await mkdir(binDir, { recursive: true })

  const scriptPath = expandPath(RUN_SCRIPT_PATH)
  const scriptContent = `#!/bin/bash
source ~/.profile 2>/dev/null || true
source ~/.bashrc 2>/dev/null || true
exec openfox
`
  await writeFile(scriptPath, scriptContent, { encoding: 'utf-8' })

  await exec('chmod', ['+x', scriptPath])
  console.log(`Created: ${scriptPath}`)
}

async function createSystemdService(): Promise<void> {
  const serviceDir = expandPath('~/.config/systemd/user')
  await mkdir(serviceDir, { recursive: true })

  const servicePath = expandPath(SERVICE_PATH)
  const serviceContent = `[Unit]
Description=OpenFox Agentic Coding Assistant

[Service]
Type=simple
ExecStart=${expandPath(RUN_SCRIPT_PATH)}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`
  await writeFile(servicePath, serviceContent, 'utf-8')
  console.log(`Created: ${servicePath}`)
}

export async function runServiceCommand(_mode: Mode, subcommand?: string): Promise<void> {
  if (!subcommand) {
    printServiceHelp()
    return
  }

  switch (subcommand) {
    case 'install':
      await serviceInstall()
      break
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
      await serviceLogs()
      break
    case 'uninstall':
      await serviceUninstall()
      break
    default:
      console.error(`Unknown subcommand: ${subcommand}`)
      printServiceHelp()
      process.exit(1)
  }
}

function printServiceHelp(): void {
  console.log(`
OpenFox Service Management

Usage:
  openfox service <command>

Commands:
  install    Install and enable the systemd service
  start      Start the service (if installed)
  stop       Stop the service (if installed)
  restart    Restart the service (if installed)
  status     Show service status
  logs       Show recent service logs
  uninstall  Disable and remove the service files
`)
}

async function serviceInstall(): Promise<void> {
  console.log('Installing OpenFox service...\n')

  const installed = await pathExists(SERVICE_PATH)
  if (installed) {
    const { success } = systemctl(['is-active', SERVICE_NAME], true)
    if (success) {
      console.log('Service is already installed and running.')
      return
    }
    console.log('Service files exist. Reinstalling...')
    await serviceUninstall()
  }

  await createWrapperScript()
  await createSystemdService()

  systemctl(['daemon-reload'])
  systemctl(['enable', SERVICE_NAME])
  systemctl(['start', SERVICE_NAME])

  console.log('\n✓ Service installed and started')
}

async function serviceStart(): Promise<void> {
  const installed = await pathExists(SERVICE_PATH)
  if (!installed) {
    console.log('Service not installed. Run "openfox service install" first.')
    return
  }

  const { success } = systemctl(['is-active', SERVICE_NAME], true)
  if (success) {
    console.log('Service is already running.')
    return
  }

  systemctl(['start', SERVICE_NAME])
  console.log('✓ Service started')
}

async function serviceStop(): Promise<void> {
  const installed = await pathExists(SERVICE_PATH)
  if (!installed) {
    console.log('Service not installed.')
    return
  }

  const { success } = systemctl(['is-active', SERVICE_NAME], true)
  if (!success) {
    console.log('Service is not running.')
    return
  }

  systemctl(['stop', SERVICE_NAME])
  console.log('✓ Service stopped')
}

async function serviceRestart(): Promise<void> {
  const installed = await pathExists(SERVICE_PATH)
  if (!installed) {
    console.log('Service not installed.')
    return
  }

  systemctl(['restart', SERVICE_NAME])
  console.log('✓ Service restarted')
}

async function serviceStatus(): Promise<void> {
  const installed = await pathExists(SERVICE_PATH)
  if (!installed) {
    console.log('Service: not installed')
    return
  }

  console.log('Service: installed')
  systemctl(['is-active', SERVICE_NAME], false)
  systemctl(['is-enabled', SERVICE_NAME], false)
}

async function serviceLogs(): Promise<void> {
  const installed = await pathExists(SERVICE_PATH)
  if (!installed) {
    console.log('Service not installed.')
    return
  }

  const result = spawnSync('journalctl', ['--user', '-u', SERVICE_NAME, '-n', '50', '--no-pager'], {
    encoding: 'utf-8',
  })
  console.log(result.stdout || result.stderr || 'No logs')
}

async function serviceUninstall(): Promise<void> {
  console.log('Uninstalling OpenFox service...\n')

  const installed = await pathExists(SERVICE_PATH)
  if (!installed) {
    console.log('Service not installed.')
    return
  }

  const { success } = systemctl(['is-active', SERVICE_NAME], true)
  if (success) {
    systemctl(['stop', SERVICE_NAME])
  }

  systemctl(['disable', SERVICE_NAME])

  try {
    await rm(expandPath(SERVICE_PATH))
    console.log(`Removed: ${expandPath(SERVICE_PATH)}`)
  } catch {
    // ignore
  }

  try {
    await rm(expandPath(RUN_SCRIPT_PATH))
    console.log(`Removed: ${expandPath(RUN_SCRIPT_PATH)}`)
  } catch {
    // ignore
  }

  systemctl(['daemon-reload'])

  console.log('\n✓ Service uninstalled')
}

type Mode = 'production' | 'development' | 'test'
