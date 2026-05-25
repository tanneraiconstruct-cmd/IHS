import { create } from "zustand";
import type { PresencePayload } from "@/lib/realtime/presence";

export type ConnectionStatus = "connecting" | "live" | "offline";

interface PresenceStore {
  online: Record<string, PresencePayload>;
  connection: ConnectionStatus;
  setOnline: (raw: Record<string, PresencePayload[]>) => void;
  setConnection: (s: ConnectionStatus) => void;
}

export const usePresenceStore = create<PresenceStore>((set) => ({
  online: {},
  connection: "connecting",
  setOnline: (raw) => {
    const flat: Record<string, PresencePayload> = {};
    for (const [key, arr] of Object.entries(raw)) {
      if (arr && arr.length > 0) flat[key] = arr[0];
    }
    set({ online: flat });
  },
  setConnection: (connection) => set({ connection }),
}));
