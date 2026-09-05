import { create } from 'zustand'

export interface NotificationToast {
  id: string
  title: string
  body: string
  source: string
  createdAt: string
}

interface NotificationToastsState {
  toasts: NotificationToast[]
  dismissToast: (id: string) => void
  pushToast: (toast: NotificationToast) => void
  clearToasts: () => void
}

export const useNotificationToastsStore = create<NotificationToastsState>((set, get) => ({
  toasts: [],

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },

  pushToast: (toast) => {
    set((state) => ({ toasts: [...state.toasts, toast] }))
    setTimeout(() => {
      get().dismissToast(toast.id)
    }, 5000)
  },

  clearToasts: () => {
    set({ toasts: [] })
  },
}))
