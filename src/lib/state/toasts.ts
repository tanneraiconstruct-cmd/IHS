import { create } from "zustand";

export type ToastLevel = "error" | "warn" | "info";

export interface Toast {
  id: string;
  level: ToastLevel;
  body: string;
}

interface ToastState {
  items: Toast[];
  push: (level: ToastLevel, body: string) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (level, body) => {
    const id = crypto.randomUUID();
    set((s) => ({ items: [...s.items, { id, level, body }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), 6000);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

export const toast = {
  error: (body: string) => useToastStore.getState().push("error", body),
  warn: (body: string) => useToastStore.getState().push("warn", body),
  info: (body: string) => useToastStore.getState().push("info", body),
};
