"use client";

import { clsx } from "clsx";
import type { ActivityResult } from "@/lib/schedule-engine";
import type { DbActivity } from "@/lib/schedule/types";
import { useUiStore } from "@/lib/state/ui-store";
import { BAR_H, BAR_TOP_OFFSET, barRect, type BarRect } from "./layout";

interface Props {
  activity: DbActivity;
  result: ActivityResult;
  projectStart: string;
  rowIndex: number;
}

export function GanttBar({ activity, result, projectStart, rowIndex }: Props) {
  const selectedId = useUiStore((s) => s.selectedActivityId);
  const select = useUiStore((s) => s.select);
  const selected = selectedId === activity.id;
  const rect: BarRect = barRect({
    projectStart,
    plannedStart: result.plannedStart,
    plannedFinish: result.plannedFinish,
    rowIndex,
  });

  if (activity.activity_type === "milestone") {
    return (
      <button
        onClick={() => select(activity.id)}
        className={clsx(
          "absolute flex items-center justify-center",
          selected && "ring-2 ring-sky-400",
        )}
        style={{ left: rect.left, top: rect.top + BAR_TOP_OFFSET - 2, width: 20, height: 20 }}
        title={activity.name}
      >
        <span
          className={clsx(
            "block h-3 w-3 rotate-45",
            result.isCritical ? "bg-red-600" : "bg-amber-500",
          )}
        />
      </button>
    );
  }

  const pct = Math.max(0, Math.min(100, activity.percent_complete));

  return (
    <button
      onClick={() => select(activity.id)}
      className={clsx(
        "absolute overflow-hidden rounded text-[10px] text-white",
        result.isCritical ? "bg-red-600" : "bg-slate-600",
        selected && "ring-2 ring-sky-400",
      )}
      style={{
        left: rect.left,
        top: rect.top + BAR_TOP_OFFSET,
        width: rect.width,
        height: BAR_H,
      }}
      title={`${activity.name} (${result.plannedStart} → ${result.plannedFinish})`}
    >
      {pct > 0 && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-black/40"
          style={{ width: `${pct}%` }}
        />
      )}
      <span className="relative block truncate px-1 leading-4">{activity.name}</span>
    </button>
  );
}
