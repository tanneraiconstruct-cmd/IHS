"use client";

import { clsx } from "clsx";
import { useMemo, useState } from "react";
import type { BootstrapData, IndexedResult } from "@/lib/schedule/types";
import { useUiStore } from "@/lib/state/ui-store";

type SortKey = "name" | "plannedStart" | "plannedFinish" | "totalFloat";

interface Props {
  bootstrap: BootstrapData;
  indexed: IndexedResult;
}

export function ListView({ bootstrap, indexed }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("plannedStart");
  const [asc, setAsc] = useState(true);
  const selectedId = useUiStore((s) => s.selectedActivityId);
  const select = useUiStore((s) => s.select);
  const criticalOnly = useUiStore((s) => s.filters.criticalOnly);

  const rows = useMemo(() => {
    const alive = bootstrap.activities.filter((a) => a.deleted_at === null);
    const visible = criticalOnly
      ? alive.filter((a) => indexed.byActivity.get(a.id)?.isCritical)
      : alive;
    const sorted = [...visible].sort((a, b) => {
      const ra = indexed.byActivity.get(a.id);
      const rb = indexed.byActivity.get(b.id);
      switch (sortKey) {
        case "name": return a.name.localeCompare(b.name) * (asc ? 1 : -1);
        case "plannedStart":
          return ((ra?.plannedStart ?? "").localeCompare(rb?.plannedStart ?? "")) * (asc ? 1 : -1);
        case "plannedFinish":
          return ((ra?.plannedFinish ?? "").localeCompare(rb?.plannedFinish ?? "")) * (asc ? 1 : -1);
        case "totalFloat":
          return ((ra?.totalFloat ?? 0) - (rb?.totalFloat ?? 0)) * (asc ? 1 : -1);
      }
    });
    return sorted;
  }, [bootstrap.activities, indexed, sortKey, asc, criticalOnly]);

  function header(key: SortKey, label: string) {
    const active = sortKey === key;
    return (
      <button
        onClick={() => {
          if (active) setAsc((v) => !v);
          else { setSortKey(key); setAsc(true); }
        }}
        className={clsx("text-left", active && "text-sky-700 font-medium")}
      >
        {label}{active ? (asc ? " ↑" : " ↓") : ""}
      </button>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-slate-100 text-slate-700">
          <tr>
            <th className="px-2 py-1.5 text-left">{header("name", "Name")}</th>
            <th className="w-24 px-2 py-1.5 text-left">{header("plannedStart", "Start")}</th>
            <th className="w-24 px-2 py-1.5 text-left">{header("plannedFinish", "Finish")}</th>
            <th className="w-20 px-2 py-1.5 text-left">Dur</th>
            <th className="w-20 px-2 py-1.5 text-left">% Comp</th>
            <th className="w-20 px-2 py-1.5 text-left">{header("totalFloat", "TF")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const r = indexed.byActivity.get(a.id);
            return (
              <tr
                key={a.id}
                onClick={() => select(a.id)}
                className={clsx(
                  "cursor-pointer border-b border-slate-100",
                  selectedId === a.id ? "bg-sky-50" : "hover:bg-slate-50",
                  r?.isCritical && "text-red-700",
                )}
              >
                <td className="px-2 py-1.5">{a.name}</td>
                <td className="px-2 py-1.5">{r?.plannedStart ?? "—"}</td>
                <td className="px-2 py-1.5">{r?.plannedFinish ?? "—"}</td>
                <td className="px-2 py-1.5">{a.original_duration}d</td>
                <td className="px-2 py-1.5">{Math.round(a.percent_complete)}%</td>
                <td className="px-2 py-1.5">{r?.totalFloat ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
