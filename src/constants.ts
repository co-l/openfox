import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const pkgPath = join(process.cwd(), 'package.json')
const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf-8')) : { version: '0.0.0' }
const isDev = process.env['OPENFOX_DEV'] === 'true'
export const VERSION = isDev ? `${pkg.version}-dev` : pkg.version