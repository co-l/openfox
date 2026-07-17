import { authFetch } from '../lib/api'

type SetFn = (partial: unknown) => void

export async function fetchItems(url: string, set: SetFn, hasProjectItems?: boolean): Promise<void> {
  set({ loading: true } as Record<string, unknown>)
  try {
    const res = await authFetch(url)
    const data = await res.json()
    set({
      defaults: data.defaults ?? [],
      userItems: data.userItems ?? [],
      ...(hasProjectItems ? { projectItems: data.projectItems ?? [], overrideIds: data.overrideIds ?? [] } : {}),
      loading: false,
    } as Record<string, unknown>)
  } catch {
    set({ loading: false } as Record<string, unknown>)
  }
}
