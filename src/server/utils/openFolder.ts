import { platform } from 'node:os'
import { mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

export async function openFolder(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'explorer' : 'xdg-open'
  try {
    await execFileP(cmd, [dir], { timeout: 5000 })
  } catch (err) {
    // explorer.exe exits with code 1 even when the folder opens successfully
    if (platform() !== 'win32' || (err as { code?: number | string }).code !== 1) {
      throw err
    }
  }
}
