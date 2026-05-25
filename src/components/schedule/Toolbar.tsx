"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";
import { Calendar, Edit3, List, Search, TimerReset, Zap } from "lucide-react";
import type { Problem } from "@/lib/schedule-engine";
import { useUiStore, type ScheduleView } from "@/lib/state/ui-store";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { ProblemsBadge } from "./ProblemsBadge";

const VIEWS: { key: ScheduleView; label: string; Icon: typeof List }[] = [
  { key: "gantt", label: "Gantt", Icon: TimerReset },
  { key: "list", label: "List", Icon: List },
  { key: "calendar", label: "Calendar", Icon: Calendar },
  { key: "lookahead", label: "Lookahead", Icon: Search },
];

interface ToolbarProps {
  projectName: string;
  problems: Problem[];
  right?: ReactNode;
}

export function Toolbar({ projectName, problems, right }: ToolbarProps) {
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const mode = useUiStore((s) => s.mode);
  const enterEditMode = useUiStore((s) => s.enterEditMode);
  const exitEditMode = useUiStore((s) => s.exitEditMode);
  const criticalOnly = useUiStore((s) => s.filters.criticalOnly);
  const setFilter = useUiStore((s) => s.setFilter);
  const router = useRouter();

  async function logout() {
    const sb = createSupabaseBrowserClient();
    await sb.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
      <div className="flex items-center gap-4">
        <div className="text-sm font-semibold text-slate-900">{projectName}</div>
        <nav className="flex items-center gap-1">
          {VIEWS.map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={clsx(
                "flex items-center gap-1 rounded px-2 py-1 text-xs",
                view === key
                  ? "bg-sky-600 text-white"
                  : "text-slate-600 hover:bg-slate-100",
              )}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-2">
        {right}
        <button
          onClick={() => setFilter("criticalOnly", !criticalOnly)}
          className={clsx(
            "flex items-center gap-1 rounded border px-2 py-1 text-xs",
            criticalOnly
              ? "border-red-300 bg-red-50 text-red-700"
              : "border-slate-200 text-slate-600 hover:bg-slate-50",
          )}
          aria-pressed={criticalOnly}
        >
          <Zap size={14} />
          Critical path
        </button>
        <ProblemsBadge problems={problems} />
        <button
          onClick={mode === "edit" ? exitEditMode : enterEditMode}
          className={clsx(
            "flex items-center gap-1 rounded px-2 py-1 text-xs",
            mode === "edit"
              ? "bg-amber-500 text-white"
              : "border border-slate-200 text-slate-600 hover:bg-slate-50",
          )}
        >
          <Edit3 size={14} />
          {mode === "edit" ? "Exit edit" : "Edit mode"}
        </button>
        <button
          onClick={logout}
          className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
