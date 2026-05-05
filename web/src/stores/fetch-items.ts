import { authFetch } from '../lib/api'

type SetFn = (partial: unknown) => void

export async function fetchItems(url: string, set: SetFn): Promise<void> {
  set({ loading: true } as Record<string, unknown>)
  try {
    const res = await authFetch(url)
    const data = await res.json()
    set({
      defaults: data.defaults ?? [],
      userItems: data.userItems ?? [],
      loading: false,
    } as Record<string, unknown>)
  } catch {
    set({ loading: false } as Record<string, unknown>)
  }
}
