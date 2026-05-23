"use client";

import { useMemo } from "react";
import type { BootstrapData, IndexedResult } from "@/lib/schedule/types";
import { useUiStore } from "@/lib/state/ui-store";
import { DAY_W, ROW_H, barRect, isoDiffDays } from "./layout";
import { GanttGrid } from "./GanttGrid";
import { GanttHeader } from "./GanttHeader";
import { GanttBar } from "./GanttBar";
import { GanttDependency } from "./GanttDependency";

interface Props {
  bootstrap: BootstrapData;
  indexed: IndexedResult;
}

export function GanttChart({ bootstrap, indexed }: Props) {
  const criticalOnly = useUiStore((s) => s.filters.criticalOnly);
  const projectStart = bootstrap.project.project_start;

  const rows = useMemo(() => {
    const alive = bootstrap.activities.filter((a) => a.deleted_at === null);
    const sorted = [...alive].sort((a, b) => {
      const ra = indexed.byActivity.get(a.id);
      const rb = indexed.byActivity.get(b.id);
      const sa = ra?.plannedStart ?? "9999-12-31";
      const sb_ = rb?.plannedStart ?? "9999-12-31";
      return sa.localeCompare(sb_);
    });
    return criticalOnly
      ? sorted.filter((a) => indexed.byActivity.get(a.id)?.isCritical)
      : sorted;
  }, [bootstrap.activities, indexed, criticalOnly]);

  const totalDays = useMemo(() => {
    let max = isoDiffDays(projectStart, projectStart) + 1;
    for (const a of rows) {
      const r = indexed.byActivity.get(a.id);
      if (r) {
        max = Math.max(max, isoDiffDays(projectStart, r.plannedFinish) + 2);
      }
    }
    return Math.max(60, max + 7);
  }, [projectStart, rows, indexed]);

  return (
    <div className="relative h-full overflow-auto bg-white">
      <div style={{ width: totalDays * DAY_W }}>
        <GanttHeader projectStart={projectStart} totalDays={totalDays} />
        <div className="relative" style={{ height: rows.length * ROW_H }}>
          <GanttGrid totalDays={totalDays} rowCount={rows.length} />
          <svg
            className="pointer-events-none absolute inset-0"
            width={totalDays * DAY_W}
            height={rows.length * ROW_H}
          >
            <defs>
              <marker id="gantt-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
              </marker>
            </defs>
            {bootstrap.dependencies
              .filter((d) => d.deleted_at === null)
              .map((d) => {
                const predRowIdx = rows.findIndex((r) => r.id === d.predecessor_id);
                const succRowIdx = rows.findIndex((r) => r.id === d.successor_id);
                if (predRowIdx < 0 || succRowIdx < 0) return null;
                const predR = indexed.byActivity.get(d.predecessor_id);
                const succR = indexed.byActivity.get(d.successor_id);
                if (!predR || !succR) return null;
                const pred = barRect({
                  projectStart, plannedStart: predR.plannedStart, plannedFinish: predR.plannedFinish, rowIndex: predRowIdx,
                });
                const succ = barRect({
                  projectStart, plannedStart: succR.plannedStart, plannedFinish: succR.plannedFinish, rowIndex: succRowIdx,
                });
                return <GanttDependency key={d.id} pred={pred} succ={succ} active={d.is_active} />;
              })}
          </svg>
          {rows.map((a, i) => {
            const r = indexed.byActivity.get(a.id);
            if (!r) return null;
            return (
              <GanttBar
                key={a.id}
                activity={a}
                result={r}
                projectStart={projectStart}
                rowIndex={i}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
