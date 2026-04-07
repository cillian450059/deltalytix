import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface ChecklistItem {
  id: string
  text: string
  completed: boolean
  createdAt: string // ISO string for serialization
}

interface ChecklistStore {
  items: ChecklistItem[]
  addItem: (text: string) => void
  toggleItem: (id: string) => void
  removeItem: (id: string) => void
  updateItem: (id: string, text: string) => void
}

export const useChecklistStore = create<ChecklistStore>()(
  persist(
    (set) => ({
      items: [],

      addItem: (text) =>
        set((state) => ({
          items: [
            ...state.items,
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              text: text.trim(),
              completed: false,
              createdAt: new Date().toISOString(),
            },
          ],
        })),

      toggleItem: (id) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, completed: !item.completed } : item
          ),
        })),

      removeItem: (id) =>
        set((state) => ({
          items: state.items.filter((item) => item.id !== id),
        })),

      updateItem: (id, text) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, text: text.trim() } : item
          ),
        })),
    }),
    {
      name: 'checklist-widget-store',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
