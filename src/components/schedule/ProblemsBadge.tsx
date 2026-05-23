"use client";

import { clsx } from "clsx";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import type { Problem } from "@/lib/schedule-engine";
import { useUiStore } from "@/lib/state/ui-store";

interface Props {
  problems: Problem[];
}

export function ProblemsBadge({ problems }: Props) {
  const [open, setOpen] = useState(false);
  const select = useUiStore((s) => s.select);

  if (problems.length === 0) return null;
  const errors = problems.filter((p) => p.severity === "error").length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "flex items-center gap-1 rounded px-2 py-1 text-xs",
          errors > 0
            ? "bg-red-100 text-red-800 hover:bg-red-200"
            : "bg-amber-100 text-amber-800 hover:bg-amber-200",
        )}
      >
        <AlertTriangle size={14} />
        {problems.length} problem{problems.length === 1 ? "" : "s"}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-80 rounded border border-slate-200 bg-white p-2 shadow-md">
          <ul className="max-h-72 overflow-y-auto text-xs">
            {problems.map((p, i) => (
              <li key={i} className="border-b border-slate-100 py-1 last:border-b-0">
                <div className="flex items-start gap-2">
                  <span
                    className={clsx(
                      "mt-0.5 rounded px-1 text-[10px]",
                      p.severity === "error" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700",
                    )}
                  >
                    {p.severity}
                  </span>
                  <div className="flex-1">
                    <div className="text-slate-700">{p.message}</div>
                    {p.activityIds.length > 0 && (
                      <button
                        onClick={() => {
                          select(p.activityIds[0]);
                          setOpen(false);
                        }}
                        className="mt-1 text-[10px] text-sky-600 underline"
                      >
                        Go to activity
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
