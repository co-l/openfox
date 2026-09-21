import { useConfig } from './useConfig'

export function useWorkdir(): string | null {
  return useConfig().config?.workdir ?? null
}
