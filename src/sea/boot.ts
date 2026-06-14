/* eslint-disable @typescript-eslint/no-require-imports */
const {
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  rmSync,
  openSync,
  readSync,
  closeSync,
  statSync,
} = require('fs')
const { join } = require('path')
const { tmpdir, platform, homedir } = require('os')
const { fork, execSync } = require('child_process')
const { createRequire } = require('module')

function getDataDir(): string {
  if (platform() === 'win32') {
    return join(process.env['LOCALAPPDATA'] || join(homedir(), 'AppData', 'Local'), 'OpenFox-sea')
  }
  return join(process.env['XDG_DATA_HOME'] || join(homedir(), '.local', 'share'), 'openfox-sea')
}

function extractAssets(binaryPath: string, destDir: string): void {
  const st = statSync(binaryPath)
  const whole = Buffer.alloc(st.size)
  const fd = openSync(binaryPath, 'r')
  readSync(fd, whole, 0, st.size, 0)
  closeSync(fd)

  const footerSize = 12
  const footer = whole.subarray(st.size - footerSize)
  const magic = footer.readUInt32LE(8)
  if (magic !== 0x584f464e) return

  const dataOffset = footer.readUInt32LE(0)
  const dataSize = footer.readUInt32LE(4)
  const data = whole.subarray(dataOffset, dataOffset + dataSize)

  let offset = 0
  while (offset + 8 <= data.length) {
    const nameLen = data.readUInt32LE(offset)
    const contentLen = data.readUInt32LE(offset + 4)
    offset += 8
    if (offset + nameLen > data.length) break
    const name = data.subarray(offset, offset + nameLen).toString('utf-8')
    offset += nameLen
    if (offset + contentLen > data.length) break
    const content = data.subarray(offset, offset + contentLen)
    offset += contentLen

    const tarPath = join(tmpdir(), `of-${name}`)
    writeFileSync(tarPath, content)

    if (name === 'server.tar') {
      execSync(`tar -xf "${tarPath}" -C "${destDir}"`)
    } else if (name === 'addons.tar') {
      const libDir = join(destDir, 'lib')
      mkdirSync(libDir, { recursive: true })
      execSync(`tar -xf "${tarPath}" -C "${libDir}"`)
    } else if (name === 'web.tar') {
      const webDir = join(destDir, 'dist', 'web')
      mkdirSync(webDir, { recursive: true })
      execSync(`tar -xf "${tarPath}" -C "${webDir}"`)
    }
  }
}

function main(): void {
  const dataDir = getDataDir()
  const appDir = join(dataDir, 'app')

  if (process.env['OPENFOX_FORKED']) {
    const serverPath = join(appDir, 'server', 'index.cjs')
    createRequire(serverPath)(serverPath)
    return
  }

  const versionFile = join(appDir, '.version')
  const currentVersion = process.env['VERSION'] || '0'
  const binaryMtime = statSync(process.execPath).mtimeMs.toString()
  const cacheKey = `${currentVersion}|${binaryMtime}`
  const storedVersion = existsSync(versionFile) ? readFileSync(versionFile, 'utf-8').trim() : ''
  const needsExtract = !existsSync(appDir) || storedVersion !== cacheKey

  if (needsExtract) {
    if (existsSync(appDir)) {
      rmSync(appDir, { recursive: true, force: true })
    }
    mkdirSync(appDir, { recursive: true })
    extractAssets(process.execPath, appDir)
    writeFileSync(versionFile, cacheKey)
  }

  const serverEntry = join(appDir, 'server', 'index.cjs')
  if (!existsSync(serverEntry)) {
    console.error('Server entry not found at:', serverEntry)
    process.exit(1)
  }

  const libDir = join(appDir, 'lib')
  const existingPath = process.env['NODE_PATH'] || ''
  const sep = platform() === 'win32' ? ';' : ':'
  process.env['NODE_PATH'] = [libDir, existingPath].filter(Boolean).join(sep)
  process.env['OPENFOX_FORKED'] = '1'

  const child = fork(serverEntry, [], {
    env: { ...process.env },
    stdio: 'inherit',
    execPath: process.execPath,
  })

  child.on('error', (err: Error) => {
    console.error('Failed to start server:', err.message)
    process.exit(1)
  })

  child.on('exit', (code: number | null) => process.exit(code ?? 0))
}

main()
