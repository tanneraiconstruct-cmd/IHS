"use client";

import { useState } from "react";
import type { BootstrapData, IndexedResult } from "@/lib/schedule/types";
import { isoAddDays } from "../Gantt/layout";

interface Props {
  bootstrap: BootstrapData;
  indexed: IndexedResult;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function LookaheadView({ bootstrap, indexed }: Props) {
  const [selectedLookahead, setSelectedLookahead] = useState<string | null>(() => {
    const live = bootstrap.lookaheads.filter((l) => l.deleted_at === null);
    return live[0]?.id ?? null;
  });

  const lookaheads = bootstrap.lookaheads.filter((l) => l.deleted_at === null);
  const lookahead = lookaheads.find((l) => l.id === selectedLookahead) ?? null;

  const adhocRows: { id: string; name: string; start: string; finish: string; pct: number; status?: string }[] = (() => {
    if (lookahead) return [];
    const start = todayIso();
    const end = isoAddDays(start, 28);
    return bootstrap.activities
      .filter((a) => a.deleted_at === null)
      .map((a) => {
        const r = indexed.byActivity.get(a.id);
        return r ? { ...a, _start: r.plannedStart, _finish: r.plannedFinish } : null;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .filter((row) => row._start <= end && row._finish >= start)
      .map((row) => ({
        id: row.id, name: row.name, start: row._start, finish: row._finish,
        pct: Math.round(row.percent_complete),
      }));
  })();

  const persistedRows = (() => {
    if (!lookahead) return [] as { id: string; name: string; start: string; finish: string; pct: number; status?: string }[];
    return bootstrap.lookaheadTasks
      .filter((t) => t.lookahead_id === lookahead.id && t.deleted_at === null)
      .map((t) => {
        const masterResult = t.master_activity_id
          ? indexed.byActivity.get(t.master_activity_id)
          : null;
        const start = t.start_date
          ?? (masterResult && t.offset_start != null
            ? isoAddDays(masterResult.plannedStart, t.offset_start)
            : null);
        const finish = t.finish_date
          ?? (masterResult && t.offset_finish != null
            ? isoAddDays(masterResult.plannedFinish, t.offset_finish)
            : null);
        return {
          id: t.id,
          name: t.name,
          start: start ?? "—",
          finish: finish ?? "—",
          pct: Math.round(t.percent_complete),
          status: t.status ?? undefined,
        };
      });
  })();

  const rows = lookahead ? persistedRows : adhocRows;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs">
        <span className="text-slate-500">Lookahead:</span>
        <select
          value={selectedLookahead ?? ""}
          onChange={(e) => setSelectedLookahead(e.target.value || null)}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
        >
          <option value="">Auto (next 4 weeks of master)</option>
          {lookaheads.map((l) => (
            <option key={l.id} value={l.id}>{l.name} ({l.window_start}…{l.window_end})</option>
          ))}
        </select>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-100 text-slate-700">
            <tr>
              <th className="px-2 py-1.5 text-left">Task</th>
              <th className="w-28 px-2 py-1.5 text-left">Start</th>
              <th className="w-28 px-2 py-1.5 text-left">Finish</th>
              <th className="w-20 px-2 py-1.5 text-left">% Comp</th>
              <th className="w-24 px-2 py-1.5 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100">
                <td className="px-2 py-1.5">{r.name}</td>
                <td className="px-2 py-1.5">{r.start}</td>
                <td className="px-2 py-1.5">{r.finish}</td>
                <td className="px-2 py-1.5">{r.pct}%</td>
                <td className="px-2 py-1.5">{r.status ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
