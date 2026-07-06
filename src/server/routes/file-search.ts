import { Router } from 'express'
import fg from 'fast-glob'

export function createFileSearchRoutes(): Router {
  const router = Router()

  router.get('/', async (req, res) => {
    const query = (req.query['q'] as string) || ''
    const workdir = (req.query['workdir'] as string) || process.cwd()

    try {
      const results = await searchFiles(query, workdir)
      res.json(results)
    } catch {
      res.status(500).json({ error: 'File search failed' })
    }
  })

  return router
}

interface FileSuggestion {
  path: string
  name: string
  type: 'file' | 'directory'
  score: number
}

async function searchFiles(query: string, workdir: string): Promise<FileSuggestion[]> {
  const entries = await fg(['**/*'], {
    cwd: workdir,
    dot: true,
    deep: 5,
    onlyFiles: false,
    ignore: [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/.next/**',
      '**/.cache/**',
      '**/__pycache__/**',
      '**/*.lock',
      '**/.openfox/**',
    ],
    objectMode: true,
  })

  const scored: FileSuggestion[] = []

  for (const entry of entries) {
    const filePath = entry.path
    let score = fuzzyScore(filePath, query)
    if (score === 0) {
      continue
    }

    const isDir = entry.dirent.isDirectory()
    if (isDir) {
      score += 10
    }

    scored.push({
      path: filePath,
      name: filePath.split('/').pop() || filePath,
      type: isDir ? 'directory' : 'file',
      score,
    })
  }

  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, 20)
}

function fuzzyScore(filePath: string, query: string): number {
  if (!query) {
    return 1
  }
  const fileName = filePath.split('/').pop() || filePath
  const fileNameLower = fileName.toLowerCase()
  const fullPathLower = filePath.toLowerCase()
  const lowerQuery = query.toLowerCase()

  if (fileNameLower === lowerQuery) {
    return 100
  }

  if (fileNameLower.startsWith(lowerQuery)) {
    return 80
  }

  if (fileNameLower.includes(lowerQuery)) {
    return 60
  }

  if (fullPathLower.includes(lowerQuery)) {
    return 40
  }

  return 0
}
