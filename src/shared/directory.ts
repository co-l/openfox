export interface DirectoryEntry {
  name: string
  path: string
}

export interface DirectoryListing {
  current: string
  parent: string | null
  directories: DirectoryEntry[]
  basename: string
  /**
   * Available drive letters, only sent on win32. Present on regular listings
   * (so the picker can offer the drives view) and on the drives view itself.
   */
  drives?: DirectoryEntry[]
}

/** Sentinel parent path for the drives view, one level above any drive root. */
export const DRIVES_VIEW = 'drives'
