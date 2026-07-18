import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import type { WorkspaceConfig } from '../../shared/workspace.js'

const CONFIG_FILENAME = '.openfox/workspace.json'

function getConfigPath(workdir: string): string {
  return join(resolve(workdir), CONFIG_FILENAME)
}

export async function loadWorkspaceConfig(workdir: string): Promise<WorkspaceConfig | null> {
  try {
    const configPath = getConfigPath(workdir)
    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed.setup) return null
    return { setup: parsed.setup }
  } catch {
    return null
  }
}

export async function saveWorkspaceConfig(workdir: string, config: WorkspaceConfig): Promise<void> {
  const resolved = resolve(workdir)
  const dirPath = join(resolved, '.openfox')
  await mkdir(dirPath, { recursive: true })
  const configPath = getConfigPath(workdir)
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}
