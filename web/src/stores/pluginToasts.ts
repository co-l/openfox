import { create } from 'zustand'
import type { PluginNotification } from '@shared/plugin.js'

export interface PluginToast {
  notification: PluginNotification
  expiresAt: number
}

interface PluginToastStore {
  toasts: PluginToast[]
  push: (notification: PluginNotification) => void
  dismiss: (id: string) => void
  clear: () => void
}

const TOAST_DURATION_MS = 5000

export const usePluginToastStore = create<PluginToastStore>((set) => ({
  toasts: [],
  push: (notification) =>
    set((state) => ({
      toasts: [...state.toasts, { notification, expiresAt: Date.now() + TOAST_DURATION_MS }].slice(-5),
    })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.notification.id !== id) })),
  clear: () => set({ toasts: [] }),
}))
