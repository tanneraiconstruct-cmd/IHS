"use client";

import { useMemo, useRef, useState } from "react";
import type { BootstrapData, IndexedResult } from "@/lib/schedule/types";
import { useInsertDependency } from "@/lib/state/mutations";
import { useUiStore } from "@/lib/state/ui-store";
import { DAY_W, ROW_H, barRect, dependencyPath, isoDiffDays } from "./layout";
import { GanttGrid } from "./GanttGrid";
import { GanttHeader } from "./GanttHeader";
import { GanttBar } from "./GanttBar";
import { GanttDependency } from "./GanttDependency";

interface Props {
  bootstrap: BootstrapData;
  indexed: IndexedResult;
  projectId: string;
}

interface DragDep {
  fromActivityId: string;
  cursorX: number;
  cursorY: number;
  fromRect: { left: number; top: number; width: number };
}

export function GanttChart({ bootstrap, indexed, projectId }: Props) {
  const mode = useUiStore((s) => s.mode);
  const criticalOnly = useUiStore((s) => s.filters.criticalOnly);
  const insertDep = useInsertDependency(projectId);
  const projectStart = bootstrap.project.project_start;
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragDep | null>(null);

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
    let max = 1;
    for (const a of rows) {
      const r = indexed.byActivity.get(a.id);
      if (r) max = Math.max(max, isoDiffDays(projectStart, r.plannedFinish) + 2);
    }
    return Math.max(60, max + 7);
  }, [projectStart, rows, indexed]);

  function startDrawDep(activityId: string, clientX: number, clientY: number) {
    if (mode !== "edit") return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const idx = rows.findIndex((r) => r.id === activityId);
    const result = indexed.byActivity.get(activityId);
    if (idx < 0 || !result) return;
    const fromRect = barRect({
      projectStart, plannedStart: result.plannedStart, plannedFinish: result.plannedFinish, rowIndex: idx,
    });
    setDrag({
      fromActivityId: activityId,
      cursorX: clientX - rect.left + container.scrollLeft,
      cursorY: clientY - rect.top + container.scrollTop,
      fromRect,
    });
  }

  function onContainerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const container = containerRef.current!;
    const rect = container.getBoundingClientRect();
    setDrag({
      ...drag,
      cursorX: e.clientX - rect.left + container.scrollLeft,
      cursorY: e.clientY - rect.top + container.scrollTop,
    });
  }

  function onContainerPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const target = (e.target as HTMLElement).closest("[data-activity-id]");
    const toId = target?.getAttribute("data-activity-id") ?? null;
    setDrag(null);
    if (!toId || toId === drag.fromActivityId) return;
    insertDep.mutate({
      predecessorId: drag.fromActivityId,
      successorId: toId,
      type: "FS",
      lag: 0,
    });
  }

  const ghostRect = drag
    ? { left: drag.cursorX, top: drag.cursorY - 8, width: 0 }
    : null;

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-auto bg-white"
      onPointerMove={onContainerPointerMove}
      onPointerUp={onContainerPointerUp}
    >
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
            {drag && ghostRect && (
              <path
                d={dependencyPath(drag.fromRect, ghostRect)}
                fill="none"
                stroke="#0ea5e9"
                strokeWidth={1.5}
                strokeDasharray="4 4"
              />
            )}
          </svg>
          {rows.map((a, i) => {
            const r = indexed.byActivity.get(a.id);
            if (!r) return null;
            return (
              <div key={a.id} data-activity-id={a.id} className="absolute inset-x-0" style={{ top: 0, left: 0 }}>
                <GanttBar
                  activity={a}
                  result={r}
                  projectStart={projectStart}
                  rowIndex={i}
                  projectId={projectId}
                />
                {mode === "edit" && (
                  <button
                    className="gantt-dep-handle absolute h-3 w-3 -translate-y-1/2 rounded-full bg-amber-400 ring-2 ring-amber-700"
                    style={{
                      left: barRect({ projectStart, plannedStart: r.plannedStart, plannedFinish: r.plannedFinish, rowIndex: i }).left
                        + barRect({ projectStart, plannedStart: r.plannedStart, plannedFinish: r.plannedFinish, rowIndex: i }).width
                        - 6,
                      top: i * ROW_H + 18,
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      startDrawDep(a.id, e.clientX, e.clientY);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
