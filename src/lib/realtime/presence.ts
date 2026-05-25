export interface PresencePayload {
  userId: string;
  displayName: string;
  color: string;
  editMode: boolean;
  joinedAt: string;
}

export const PRESENCE_PALETTE = [
  "#2563eb",  // blue
  "#dc2626",  // red
  "#16a34a",  // green
  "#9333ea",  // purple
  "#ea580c",  // orange
  "#0891b2",  // cyan
  "#db2777",  // pink
  "#65a30d",  // lime
] as const;

export function deriveColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return PRESENCE_PALETTE[h % PRESENCE_PALETTE.length];
}
