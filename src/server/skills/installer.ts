import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import matter from 'gray-matter'
import { pathExists } from '../shared/item-loader.js'

export interface SkillPackageFile {
  path: string
  content: Buffer
}

export class SkillInstallError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

function validateRelativePath(path: string): void {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new SkillInstallError(`Invalid package path: ${path}`, 400)
  }
}

function validatePackageName(name: string): void {
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..' || name.includes('\0')) {
    throw new SkillInstallError('Invalid package name', 400)
  }
}

export async function installSkillPackage(
  libraryDir: string,
  packageName: string,
  files: SkillPackageFile[],
): Promise<{ id: string; path: string }> {
  validatePackageName(packageName)
  if (!files.length || files.length > 1000) throw new SkillInstallError('Package must contain 1-1000 files', 400)
  if (!files.some((file) => file.path === 'SKILL.md')) throw new SkillInstallError('Package must contain SKILL.md', 400)
  let totalBytes = 0
  const paths = new Set<string>()
  for (const file of files) {
    validateRelativePath(file.path)
    if (paths.has(file.path)) throw new SkillInstallError(`Duplicate package path: ${file.path}`, 400)
    paths.add(file.path)
    if (file.content.byteLength > 25 * 1024 * 1024) throw new SkillInstallError('Package file exceeds 25 MiB', 413)
    totalBytes += file.content.byteLength
  }
  if (totalBytes > 50 * 1024 * 1024) throw new SkillInstallError('Package exceeds 50 MiB', 413)

  const destination = join(libraryDir, packageName)
  if (await pathExists(destination)) throw new SkillInstallError('A package with this name already exists', 409)
  const staging = join(libraryDir, `.${packageName}.openfox-upload-${randomUUID()}`)

  try {
    await mkdir(staging, { recursive: false })
    for (const file of files) {
      const target = join(staging, file.path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, file.content)
    }
    const parsed = matter(await readFile(join(staging, 'SKILL.md'), 'utf-8'))
    const name = typeof parsed.data['name'] === 'string' ? parsed.data['name'].trim() : ''
    const description = typeof parsed.data['description'] === 'string' ? parsed.data['description'].trim() : ''
    if (!name || !description || !parsed.content.trim()) {
      throw new SkillInstallError('SKILL.md requires name, description, and instructions', 400)
    }
    if (await pathExists(destination)) throw new SkillInstallError('A package with this name already exists', 409)
    await rename(staging, destination)
    return { id: name, path: destination }
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}
