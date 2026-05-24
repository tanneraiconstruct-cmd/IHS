"use client";

import { Edit3 } from "lucide-react";
import { useUiStore } from "@/lib/state/ui-store";

export function EditModeBanner() {
  const mode = useUiStore((s) => s.mode);
  const exit = useUiStore((s) => s.exitEditMode);
  if (mode !== "edit") return null;
  return (
    <div className="flex items-center justify-between border-b border-amber-300 bg-amber-100 px-4 py-1.5 text-xs text-amber-900">
      <div className="flex items-center gap-2">
        <Edit3 size={14} />
        <span className="font-medium">Edit mode</span>
        <span className="text-amber-800/80">
          Changes persist on release. Discard only reverts local view — already-saved changes stay.
        </span>
      </div>
      <button
        onClick={exit}
        className="rounded bg-amber-500 px-2 py-1 text-xs font-medium text-white hover:bg-amber-600"
      >
        Done
      </button>
    </div>
  );
}
