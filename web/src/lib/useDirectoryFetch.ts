import { useCallback } from 'react'
import { authFetch } from './api'

export async function fetchDirectory(
  path?: string,
  baseDir?: string,
): Promise<{
  current: string
  parent: string | null
  directories: Array<{ name: string; path: string }>
  basename: string
}> {
  let url = '/api/directories'
  if (path) {
    url = `/api/directories?path=${encodeURIComponent(path)}`
  } else if (baseDir) {
    url = `/api/directories?path=${encodeURIComponent(baseDir)}`
  }
  const response = await authFetch(url)
  return response.json()
}

export function useDirectoryFetch<T>(setter: (data: T) => void, errorHandler?: (err: unknown) => void) {
  return useCallback(
    async (path?: string, baseDir?: string) => {
      try {
        const data = (await fetchDirectory(path, baseDir)) as T
        setter(data)
      } catch (err) {
        console.error('Failed to load directories:', err)
        errorHandler?.(err)
      }
    },
    [setter, errorHandler],
  )
}
