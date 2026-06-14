import { execSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  appendFileSync,
  statSync,
  readdirSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DIST_WEB = join(ROOT, 'dist', 'web')
const OUTPUT_DIR = join(ROOT, 'out')

function run(cmd: string): void {
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, FORCE_COLOR: '1' } })
}

async function main(): Promise<void> {
  const platform = process.platform
  const isWin = platform === 'win32'
  const ext = isWin ? '.exe' : ''
  const outputName = `openfox-core${ext}`

  console.log(`\n=== Building OpenFox SEA for ${platform}-${process.arch} ===\n`)

  // Step 1: Build web frontend
  console.log('--- Step 1: Building web frontend ---')
  execSync('npx vite build --outDir ../dist/web', {
    cwd: join(ROOT, 'web'),
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
  })

  // Step 2: Build server bundle (single CJS file with all deps bundled)
  console.log('\n--- Step 2: Building server bundle ---')
  run('npx tsup --config tsup.sea-server.config.ts')

  // Step 3: Build boot script
  console.log('\n--- Step 3: Building boot script ---')
  run('npx tsup --config tsup.sea.config.ts')

  // Step 4: Create asset archives
  console.log('\n--- Step 4: Creating archives ---')
  const assetsDir = join(ROOT, 'tmp-sea-assets')
  mkdirSync(assetsDir, { recursive: true })

  // Server code: bundled single file + defaults
  const bundleDir = join(ROOT, 'dist-sea-bundle')
  execSync(`tar -cf "${join(assetsDir, 'server.tar')}" -C "${bundleDir}" .`)

  // Web frontend
  if (existsSync(DIST_WEB)) {
    execSync(`tar -cf "${join(assetsDir, 'web.tar')}" -C "${DIST_WEB}" .`)
  }

  // Native addons + their dependencies (from node_modules)
  const addonsDir = join(assetsDir, 'addons')
  mkdirSync(addonsDir, { recursive: true })
  const addonPkgs = [
    'better-sqlite3',
    'node-pty',
    'bindings',
    'file-uri-to-path',
    'prebuild-install',
    'node-abi',
    'napi-build-utils',
    'detect-libc',
    'expand-template',
    'github-from-package',
    'minimist',
    'mkdirp-classic',
    'pump',
    'rc',
    'simple-get',
    'tar-fs',
    'tunnel-agent',
    'node-addon-api',
  ]
  // Include platform-specific rollup package if installed
  const rollupDir = join(ROOT, 'node_modules', '@rollup')
  if (existsSync(rollupDir)) {
    for (const entry of readdirSync(rollupDir)) {
      if (entry.startsWith('rollup-')) addonPkgs.push(`@rollup/${entry}`)
    }
  }
  for (const pkg of addonPkgs) {
    const src = join(ROOT, 'node_modules', pkg)
    if (existsSync(src)) {
      const dest = join(addonsDir, pkg)
      mkdirSync(dirname(dest), { recursive: true })
      execSync(`tar -cf - -C "${dirname(src)}" "${pkg}" | tar -xf - -C "${addonsDir}"`)
    }
  }
  execSync(`tar -cf "${join(assetsDir, 'addons.tar')}" -C "${addonsDir}" .`)

  // Step 4: Create SEA config
  console.log('\n--- Step 4: Creating SEA binary ---')
  const seaConfig = {
    main: join(ROOT, 'dist-sea', 'sea', 'boot.cjs'),
    output: 'sea-prep.blob',
    disableExperimentalSEAWarning: true,
  }
  const configPath = join(ROOT, 'sea-config.json')
  writeFileSync(configPath, JSON.stringify(seaConfig, null, 2))
  execSync('node --experimental-sea-config sea-config.json', { cwd: ROOT, stdio: 'inherit' })

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const outputPath = join(OUTPUT_DIR, outputName)
  copyFileSync(process.execPath, outputPath)
  execSync(
    `npx postject "${outputPath}" NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
    { stdio: 'inherit' },
  )

  // Step 5: Append assets
  console.log('\n--- Step 5: Appending assets ---')
  const assetChunks: Buffer[] = []
  for (const name of ['server.tar', 'addons.tar', 'web.tar']) {
    const assetPath = join(assetsDir, name)
    if (existsSync(assetPath)) {
      const data = readFileSync(assetPath)
      const nameBuf = Buffer.from(name, 'utf-8')
      const header = Buffer.alloc(8)
      header.writeUInt32LE(nameBuf.length, 0)
      header.writeUInt32LE(data.length, 4)
      assetChunks.push(header, nameBuf, data)
      console.log(`  ${name}: ${(data.length / 1024 / 1024).toFixed(1)} MB`)
    }
  }
  const assetData = Buffer.concat(assetChunks)
  const dataOffset = statSync(outputPath).size
  appendFileSync(outputPath, assetData)
  const footer = Buffer.alloc(12)
  footer.writeUInt32LE(dataOffset, 0)
  footer.writeUInt32LE(assetData.length, 4)
  footer.writeUInt32LE(0x584f464e, 8)
  appendFileSync(outputPath, footer)

  // Step 6: Cleanup
  console.log('\n--- Step 6: Cleanup ---')
  rmSync(configPath)
  rmSync(join(ROOT, 'sea-prep.blob'))
  rmSync(assetsDir, { recursive: true, force: true })
  if (!isWin) execSync(`chmod +x "${outputPath}"`)

  const size = (readFileSync(outputPath).length / 1024 / 1024).toFixed(1)
  console.log(`\n=== Done! ${outputName} (${size} MB) ===`)
}

main().catch((err) => {
  console.error('Build failed:', err)
  process.exit(1)
})
