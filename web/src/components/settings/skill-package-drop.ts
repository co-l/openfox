export interface DroppedSkillFile {
  path: string
  file: File
}

export interface DroppedSkillPackage {
  packageName: string
  files: DroppedSkillFile[]
}

interface BrowserFileEntry {
  isFile: boolean
  isDirectory: boolean
  name: string
  file: (success: (file: File) => void, failure?: (error: DOMException) => void) => void
}

interface BrowserDirectoryEntry {
  isFile: boolean
  isDirectory: boolean
  name: string
  createReader: () => {
    readEntries: (
      success: (entries: Array<BrowserFileEntry | BrowserDirectoryEntry>) => void,
      failure?: (error: DOMException) => void,
    ) => void
  }
}

function validatePackage(packageName: string, files: DroppedSkillFile[]): DroppedSkillPackage {
  if (!packageName || !files.some((file) => file.path === 'SKILL.md')) {
    throw new Error('Drop one folder containing SKILL.md.')
  }
  return { packageName, files }
}

export function packageFromFileList(files: Iterable<File>): DroppedSkillPackage {
  const all = [...files]
  if (!all.length) throw new Error('Choose one skill folder.')
  const roots = new Set(all.map((file) => file.webkitRelativePath.split('/')[0]).filter(Boolean))
  if (roots.size !== 1) throw new Error('Choose exactly one skill folder.')
  const packageName = [...roots][0]!
  return validatePackage(
    packageName,
    all.map((file) => ({ path: file.webkitRelativePath.slice(packageName.length + 1), file })),
  )
}

function readFile(entry: BrowserFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

async function readDirectory(entry: BrowserDirectoryEntry, prefix = ''): Promise<DroppedSkillFile[]> {
  const reader = entry.createReader()
  const entries: Array<BrowserFileEntry | BrowserDirectoryEntry> = []
  for (;;) {
    const batch = await new Promise<Array<BrowserFileEntry | BrowserDirectoryEntry>>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    )
    if (!batch.length) break
    entries.push(...batch)
  }
  const nested = await Promise.all(
    entries.map(async (child) => {
      const path = prefix ? `${prefix}/${child.name}` : child.name
      if (child.isDirectory) return readDirectory(child as BrowserDirectoryEntry, path)
      return [{ path, file: await readFile(child as BrowserFileEntry) }]
    }),
  )
  return nested.flat()
}

export async function packageFromDataTransfer(data: DataTransfer): Promise<DroppedSkillPackage> {
  const entries = [...data.items]
    .filter((item) => item.kind === 'file')
    .map(
      (item) =>
        (
          item as unknown as { webkitGetAsEntry?: () => BrowserFileEntry | BrowserDirectoryEntry | null }
        ).webkitGetAsEntry?.() ?? null,
    )
    .filter((entry): entry is BrowserFileEntry | BrowserDirectoryEntry => Boolean(entry))
  if (entries.length !== 1 || !entries[0]!.isDirectory) throw new Error('Drop exactly one skill folder.')
  const root = entries[0] as BrowserDirectoryEntry
  return validatePackage(root.name, await readDirectory(root))
}
