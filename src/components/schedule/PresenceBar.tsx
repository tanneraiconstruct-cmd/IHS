"use client";

import { clsx } from "clsx";
import { Pencil } from "lucide-react";
import { usePresenceStore } from "@/lib/state/presence-store";

interface Props {
  currentUserId: string;
}

const MAX_AVATARS = 5;

function initials(name: string): string {
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "");
}

export function PresenceBar({ currentUserId }: Props) {
  const online = usePresenceStore((s) => s.online);
  const connection = usePresenceStore((s) => s.connection);

  const entries = Object.values(online).sort((a, b) => {
    if (a.userId === currentUserId) return -1;
    if (b.userId === currentUserId) return 1;
    return a.joinedAt.localeCompare(b.joinedAt);
  });

  const visible = entries.slice(0, MAX_AVATARS);
  const overflow = entries.length - visible.length;

  const dotColor =
    connection === "live" ? "bg-emerald-500" :
    connection === "offline" ? "bg-red-500" : "bg-slate-300";

  return (
    <div className="flex items-center gap-1.5">
      <span
        data-testid="presence-connection"
        data-status={connection}
        className={clsx("inline-block h-2 w-2 rounded-full", dotColor)}
        aria-label={`Live updates ${connection}`}
      />
      <div className="flex -space-x-1.5">
        {visible.map((u) => (
          <div
            key={u.userId}
            data-testid="presence-avatar"
            data-editing={u.editMode}
            aria-label={`${u.displayName}${u.editMode ? " — Editing" : " — Viewing"}`}
            title={`${u.displayName}${u.editMode ? " — Editing" : ""}`}
            className={clsx(
              "relative flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold uppercase text-white",
              u.userId === currentUserId && "opacity-70",
            )}
            style={{
              backgroundColor: u.color,
              outline: u.editMode ? `2px solid ${u.color}` : undefined,
              outlineOffset: u.editMode ? "1px" : undefined,
            }}
          >
            {initials(u.displayName)}
            {u.editMode && (
              <Pencil
                size={8}
                className="absolute -bottom-0.5 -right-0.5 rounded-full bg-white p-[1px] text-slate-700"
                strokeWidth={3}
              />
            )}
          </div>
        ))}
        {overflow > 0 && (
          <div
            data-testid="presence-overflow"
            className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-slate-500 text-[10px] font-semibold text-white"
          >
            +{overflow}
          </div>
        )}
      </div>
    </div>
  );
}
