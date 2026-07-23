import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import type { WorkspaceConfig } from '../../shared/workspace.js'

function getGlobalConfigDir(): string {
  const suffix = process.env['OPENFOX_DEV'] === 'true' ? '-dev' : ''
  return join(homedir(), '.config', `openfox${suffix}`)
}

function getOldConfigPath(workdir: string): string {
  return join(resolve(workdir), '.openfox', 'workspace.json')
}

function getNewConfigDir(workdir: string): string {
  const hash = createHash('sha256').update(resolve(workdir)).digest('hex').slice(0, 16)
  return join(getGlobalConfigDir(), 'projects', hash)
}

function getNewConfigPath(workdir: string): string {
  return join(getNewConfigDir(workdir), 'workspace.json')
}

function parseRaw(raw: string): WorkspaceConfig | null {
  try {
    const parsed = JSON.parse(raw)
    const config: WorkspaceConfig = {}
    if (parsed.setup) config.setup = parsed.setup
    if (parsed.rootDir) config.rootDir = parsed.rootDir
    return Object.keys(config).length > 0 ? config : null
  } catch {
    return null
  }
}

export async function loadWorkspaceConfig(workdir: string): Promise<WorkspaceConfig | null> {
  const newPath = getNewConfigPath(workdir)
  try {
    const raw = await readFile(newPath, 'utf-8')
    return parseRaw(raw)
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') return null
  }

  try {
    const oldPath = getOldConfigPath(workdir)
    const raw = await readFile(oldPath, 'utf-8')
    const config = parseRaw(raw)
    if (!config) return null

    const dir = getNewConfigDir(workdir)
    await mkdir(dir, { recursive: true })
    await writeFile(newPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
    return config
  } catch {
    return null
  }
}

export async function saveWorkspaceConfig(workdir: string, config: WorkspaceConfig): Promise<void> {
  const dir = getNewConfigDir(workdir)
  await mkdir(dir, { recursive: true })
  const configPath = getNewConfigPath(workdir)
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}
