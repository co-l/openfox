import { platform } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

export async function openFolder(dir: string): Promise<void> {
  await execFileP('mkdir', ['-p', dir], { timeout: 5000 })
  const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'explorer' : 'xdg-open'
  await execFileP(cmd, [dir], { timeout: 5000 })
}
