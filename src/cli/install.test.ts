import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { buildLauncher, checkInstall, getLauncherPath, runInstall } from './install.js'

describe('persistent CLI installation', () => {
  it('builds a Unix launcher with absolute executable paths', () => {
    expect(buildLauncher('darwin', '/node/bin/node', '/npm/openfox/dist/cli/index.js')).toBe(
      "#!/bin/sh\nexec '/node/bin/node' '/npm/openfox/dist/cli/index.js' \"$@\"\n",
    )
  })

  it('builds a Windows command launcher', () => {
    expect(buildLauncher('win32', 'C:\\node\\node.exe', 'C:\\npm\\openfox\\dist\\cli\\index.js')).toBe(
      '@echo off\r\n"C:\\node\\node.exe" "C:\\npm\\openfox\\dist\\cli\\index.js" %*\r\n',
    )
  })

  it('installs and verifies a Unix launcher', async () => {
    const home = await mkdtemp(join(tmpdir(), 'openfox-install-'))
    const env = {
      platform: 'linux' as const,
      home,
      path: join(home, '.local', 'bin'),
      nodeExecutable: '/node/bin/node',
      cliExecutable: '/npm/openfox/dist/cli/index.js',
      npmPrefix: '/npm',
    }

    expect(await runInstall({ env, quiet: true })).toBe(0)
    const launcher = getLauncherPath(env)
    expect(await readFile(launcher, 'utf-8')).toBe(buildLauncher('linux', env.nodeExecutable, env.cliExecutable))

    const result = await checkInstall(env)
    expect(result.launcherPersistent).toBe(true)
    expect(result.directoryInPath).toBe(true)
  })

  it('prints the exact PATH instruction without editing shell files', async () => {
    const home = await mkdtemp(join(tmpdir(), 'openfox-install-'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runInstall({
      env: {
        platform: 'darwin',
        home,
        path: '/usr/bin',
        nodeExecutable: '/node/bin/node',
        cliExecutable: '/npm/openfox/dist/cli/index.js',
        npmPrefix: '/npm',
      },
    })

    expect(log).toHaveBeenCalledWith('Add this line to your shell configuration:\nexport PATH="$HOME/.local/bin:$PATH"')
    log.mockRestore()
  })
})
