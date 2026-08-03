// Installs web/ dependencies after a root install. Replaces the sh-only
// `if [ -f ... ]` postinstall so `npm install` works on Windows (cmd.exe).
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

if (existsSync('web/package.json') && !existsSync('web/node_modules')) {
  execSync('npm install --prefer-offline', { cwd: 'web', stdio: 'inherit' })
}
