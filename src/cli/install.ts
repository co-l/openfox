import { spawnSync } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export interface InstallEnvironment {
  platform?: NodeJS.Platform
  home?: string
  path?: string
  nodeExecutable?: string
  cliExecutable?: string
  localAppData?: string
  npmPrefix?: string
}

export interface InstallCheck {
  currentExecutable: string
  nodeExecutable: string
  npmPrefix: string
  launcherPath: string
  launcherDirectory: string
  launcherExists: boolean
  launcherPersistent: boolean
  directoryInPath: boolean
}

function npmGlobalPrefix(platform: NodeJS.Platform): string {
  const windows = platform === 'win32'
  const result = spawnSync(windows ? 'npm.cmd' : 'npm', ['prefix', '-g'], {
    encoding: 'utf-8',
    windowsHide: true,
  })
  return result.status === 0 ? (result.stdout ?? '').trim() : '(unavailable)'
}

export function getLauncherPath(env: InstallEnvironment = {}): string {
  const platform = env.platform ?? process.platform
  const home = env.home ?? homedir()
  if (platform === 'win32') {
    const base = env.localAppData ?? process.env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local')
    return join(base, 'OpenFox', 'bin', 'openfox.cmd')
  }
  return join(home, '.local', 'bin', 'openfox')
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

export function buildLauncher(platform: NodeJS.Platform, nodeExecutable: string, cliExecutable: string): string {
  if (platform === 'win32') {
    return `@echo off\r\n"${nodeExecutable}" "${cliExecutable}" %*\r\n`
  }
  return `#!/bin/sh\nexec ${quoteShell(nodeExecutable)} ${quoteShell(cliExecutable)} "$@"\n`
}

function pathContains(directory: string, pathValue: string, platform: NodeJS.Platform): boolean {
  const normalize = (value: string) => (platform === 'win32' ? value.toLowerCase() : value)
  const pathDelimiter = platform === 'win32' ? ';' : ':'
  return pathValue
    .split(pathDelimiter)
    .filter(Boolean)
    .some((entry) => normalize(entry.replace(/[\\/]$/, '')) === normalize(directory.replace(/[\\/]$/, '')))
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function checkInstall(env: InstallEnvironment = {}): Promise<InstallCheck> {
  const platform = env.platform ?? process.platform
  const launcherPath = getLauncherPath(env)
  const launcherDirectory = dirname(launcherPath)
  const nodeExecutable = env.nodeExecutable ?? process.execPath
  const cliExecutable = env.cliExecutable ?? process.argv[1] ?? ''
  const launcherExists = await fileExists(launcherPath)
  const expected = buildLauncher(platform, nodeExecutable, cliExecutable)
  const launcherPersistent = launcherExists && (await readFile(launcherPath, 'utf-8')) === expected

  return {
    currentExecutable: cliExecutable,
    nodeExecutable,
    npmPrefix: env.npmPrefix ?? npmGlobalPrefix(platform),
    launcherPath,
    launcherDirectory,
    launcherExists,
    launcherPersistent,
    directoryInPath: pathContains(launcherDirectory, env.path ?? process.env['PATH'] ?? '', platform),
  }
}

function printCheck(check: InstallCheck): void {
  console.log('OpenFox CLI installation:')
  console.log(`  Current executable: ${check.currentExecutable}`)
  console.log(`  Node executable: ${check.nodeExecutable}`)
  console.log(`  npm global prefix: ${check.npmPrefix}`)
  console.log(`  Persistent launcher: ${check.launcherPath}`)
  console.log(`  Launcher exists: ${check.launcherExists ? 'yes' : 'no'}`)
  console.log(`  Launcher is current: ${check.launcherPersistent ? 'yes' : 'no'}`)
  console.log(`  Launcher directory in PATH: ${check.directoryInPath ? 'yes' : 'no'}`)
}

export async function runInstall(
  options: { check?: boolean; quiet?: boolean; env?: InstallEnvironment } = {},
): Promise<number> {
  const env = options.env ?? {}
  const platform = env.platform ?? process.platform

  if (options.check) {
    printCheck(await checkInstall(env))
    return 0
  }

  const launcherPath = getLauncherPath(env)
  const nodeExecutable = env.nodeExecutable ?? process.execPath
  const cliExecutable = env.cliExecutable ?? process.argv[1]
  if (!cliExecutable) {
    console.error('Unable to determine the OpenFox CLI executable path.')
    return 1
  }

  await mkdir(dirname(launcherPath), { recursive: true })
  await writeFile(launcherPath, buildLauncher(platform, nodeExecutable, cliExecutable), {
    mode: platform === 'win32' ? undefined : 0o755,
  })

  const check = await checkInstall({ ...env, nodeExecutable, cliExecutable })
  if (!options.quiet) {
    console.log(`Persistent OpenFox launcher installed: ${launcherPath}`)
  }

  if (!check.directoryInPath) {
    if (platform === 'win32') {
      console.log(`Add this directory to your user PATH:\n${check.launcherDirectory}`)
    } else {
      console.log(`Add this line to your shell configuration:\nexport PATH="$HOME/.local/bin:$PATH"`)
    }
  }

  return 0
}
