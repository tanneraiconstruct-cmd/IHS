"use client";

import { clsx } from "clsx";
import { X } from "lucide-react";
import { useToastStore } from "@/lib/state/toasts";

export function Toasts() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-50 flex flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={clsx(
            "pointer-events-auto flex max-w-sm items-start gap-2 rounded border px-3 py-2 text-xs shadow-md",
            t.level === "error" && "border-red-200 bg-red-50 text-red-800",
            t.level === "warn" && "border-amber-200 bg-amber-50 text-amber-800",
            t.level === "info" && "border-slate-200 bg-white text-slate-700",
          )}
        >
          <div className="flex-1">{t.body}</div>
          <button onClick={() => dismiss(t.id)} className="opacity-60 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
