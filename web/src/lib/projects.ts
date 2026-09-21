interface StarrableProject {
  id: string
  name: string
  isStarred?: boolean
}

/**
 * Projects ordered like the project dropdown: starred first, then the rest,
 * alphabetical within each group.
 */
export function sortProjectsStarredFirst<T extends StarrableProject>(projects: T[]): T[] {
  const starred = projects.filter((p) => p.isStarred).sort((a, b) => a.name.localeCompare(b.name))
  const unstarred = projects.filter((p) => !p.isStarred).sort((a, b) => a.name.localeCompare(b.name))
  return [...starred, ...unstarred]
}
