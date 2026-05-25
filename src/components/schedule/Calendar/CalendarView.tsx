"use client";

import { clsx } from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import type { BootstrapData, IndexedResult } from "@/lib/schedule/types";
import { useUiStore } from "@/lib/state/ui-store";

interface Props {
  bootstrap: BootstrapData;
  indexed: IndexedResult;
}

function startOfMonthUtc(iso: string): Date {
  const d = new Date(iso + "T00:00:00.000Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function monthStartIso(iso: string): string {
  return isoOf(startOfMonthUtc(iso));
}

export function CalendarView({ bootstrap, indexed }: Props) {
  const dateAnchorIso = useUiStore((s) => s.dateAnchor);
  const setDateAnchor = useUiStore((s) => s.setDateAnchor);
  const select = useUiStore((s) => s.select);
  const selectedId = useUiStore((s) => s.selectedActivityId);
  const criticalOnly = useUiStore((s) => s.filters.criticalOnly);
  const anchor = startOfMonthUtc(dateAnchorIso || bootstrap.project.project_start);

  const monthLabel = anchor.toLocaleDateString("en-US", {
    month: "long", year: "numeric", timeZone: "UTC",
  });

  const cells = useMemo(() => {
    const first = anchor;
    const dayOfWeek = first.getUTCDay(); // 0 = Sun
    const gridStart = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1 - dayOfWeek));
    const list: { iso: string; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setUTCDate(d.getUTCDate() + i);
      list.push({ iso: isoOf(d), inMonth: d.getUTCMonth() === first.getUTCMonth() });
    }
    return list;
  }, [anchor]);

  const activeRows = useMemo(() => {
    return bootstrap.activities
      .filter((a) => a.deleted_at === null)
      .filter((a) => {
        if (!criticalOnly) return true;
        return indexed.byActivity.get(a.id)?.isCritical;
      });
  }, [bootstrap.activities, indexed, criticalOnly]);

  function activitiesOnDay(iso: string) {
    const hits: { id: string; name: string; critical: boolean }[] = [];
    for (const a of activeRows) {
      const r = indexed.byActivity.get(a.id);
      if (!r) continue;
      if (iso >= r.plannedStart && iso <= r.plannedFinish) {
        hits.push({ id: a.id, name: a.name, critical: r.isCritical });
      }
    }
    return hits;
  }

  function move(months: number) {
    const next = new Date(anchor);
    next.setUTCMonth(next.getUTCMonth() + months);
    setDateAnchor(isoOf(next));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <div data-testid="calendar-month-label" className="text-sm font-medium">{monthLabel}</div>
        <div className="flex items-center gap-1">
          <button
            data-testid="calendar-prev-month"
            onClick={() => move(-1)}
            className="rounded p-1 hover:bg-slate-100"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            data-testid="calendar-today"
            onClick={() =>
              setDateAnchor(monthStartIso(bootstrap.project.project_start))
            }
            className="rounded px-2 py-1 text-xs hover:bg-slate-100"
          >
            Today
          </button>
          <button
            data-testid="calendar-next-month"
            onClick={() => move(1)}
            className="rounded p-1 hover:bg-slate-100"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-7 grid-rows-[auto_repeat(6,1fr)] divide-x divide-y divide-slate-100 overflow-hidden text-xs">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-500">{d}</div>
        ))}
        {cells.map((c) => {
          const acts = activitiesOnDay(c.iso);
          const shown = acts.slice(0, 3);
          const more = acts.length - shown.length;
          return (
            <div
              key={c.iso}
              className={clsx(
                "flex min-h-0 flex-col gap-0.5 overflow-hidden p-1",
                !c.inMonth && "bg-slate-50/60 text-slate-400",
              )}
            >
              <div className="text-[10px] text-slate-500">{Number(c.iso.slice(-2))}</div>
              {shown.map((a) => (
                <button
                  key={a.id}
                  onClick={() => select(a.id)}
                  className={clsx(
                    "truncate rounded px-1 text-left text-[10px]",
                    a.critical ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700",
                    selectedId === a.id && "ring-1 ring-sky-400",
                  )}
                  title={a.name}
                >
                  {a.name}
                </button>
              ))}
              {more > 0 && (
                <div className="text-[10px] text-slate-500">+{more} more</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
