export function computeOverrideIds<T extends { metadata: { id: string } }>(
  defaults: T[],
  userItems: T[]
): string[] {
  return userItems
    .filter(u => defaults.some(d => d.metadata.id === u.metadata.id))
    .map(u => u.metadata.id)
}

export interface LoadFunctions<T> {
  loadDefaults: () => Promise<T[]>
  loadUser: (configDir: string) => Promise<T[]>
}

export async function loadAllItems<T>(
  loadDefaults: () => Promise<T[]>,
  loadUser: (configDir: string) => Promise<T[]>,
  configDir: string
): Promise<[defaults: T[], userItems: T[]]> {
  return Promise.all([loadDefaults(), loadUser(configDir)]) as Promise<[T[], T[]]>
}