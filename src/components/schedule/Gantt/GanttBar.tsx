"use client";

import { clsx } from "clsx";
import { useRef, useState } from "react";
import type { ActivityResult } from "@/lib/schedule-engine";
import type { DbActivity } from "@/lib/schedule/types";
import { useDeleteActivity, useSaveActivity } from "@/lib/state/mutations";
import { useUiStore } from "@/lib/state/ui-store";
import { ContextMenu, type MenuItem } from "../ContextMenu";
import { BAR_H, BAR_TOP_OFFSET, DAY_W, barRect, isoAddDays, type BarRect } from "./layout";

interface Props {
  activity: DbActivity;
  result: ActivityResult;
  projectStart: string;
  rowIndex: number;
  projectId: string;
}

export function GanttBar({ activity, result, projectStart, rowIndex, projectId }: Props) {
  const selectedId = useUiStore((s) => s.selectedActivityId);
  const select = useUiStore((s) => s.select);
  const mode = useUiStore((s) => s.mode);
  const save = useSaveActivity(projectId);
  const dragStateRef = useRef<{ startX: number; deltaDays: number } | null>(null);
  const selected = selectedId === activity.id;
  const rect: BarRect = barRect({
    projectStart,
    plannedStart: result.plannedStart,
    plannedFinish: result.plannedFinish,
    rowIndex,
  });

  const del = useDeleteActivity(projectId);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  function onContextMenu(e: React.MouseEvent) {
    if (mode !== "edit") return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  const menuItems: MenuItem[] = [
    {
      label: "Delete activity",
      destructive: true,
      onSelect: () => del.mutate(activity.id),
    },
  ];

  const canDrag = mode === "edit" && activity.activity_type !== "summary";

  const resizeStateRef = useRef<{ startX: number; deltaDays: number } | null>(null);

  function onResizeDown(e: React.PointerEvent<HTMLSpanElement>) {
    if (!canDrag) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    resizeStateRef.current = { startX: e.clientX, deltaDays: 0 };
  }
  function onResizeMove(e: React.PointerEvent<HTMLSpanElement>) {
    if (!resizeStateRef.current) return;
    const dx = e.clientX - resizeStateRef.current.startX;
    const days = Math.round(dx / DAY_W);
    if (days !== resizeStateRef.current.deltaDays) {
      resizeStateRef.current.deltaDays = days;
      // Visually preview by adjusting the bar width on the parent button.
      const button = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
      const newWidth = Math.max(DAY_W, rect.width + days * DAY_W);
      button.style.width = `${newWidth}px`;
    }
  }
  function onResizeUp(e: React.PointerEvent<HTMLSpanElement>) {
    const state = resizeStateRef.current;
    resizeStateRef.current = null;
    const button = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
    button.style.width = "";
    if (!state || state.deltaDays === 0) return;
    const newDuration = Math.max(0, activity.original_duration + state.deltaDays);
    save.mutate({
      id: activity.id,
      patch: {
        original_duration: newDuration,
        remaining_duration: Math.max(0, activity.remaining_duration + state.deltaDays),
      },
    });
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (!canDrag) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragStateRef.current = { startX: e.clientX, deltaDays: 0 };
  }
  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!dragStateRef.current) return;
    const dx = e.clientX - dragStateRef.current.startX;
    const days = Math.round(dx / DAY_W);
    if (days !== dragStateRef.current.deltaDays) {
      dragStateRef.current.deltaDays = days;
      e.currentTarget.style.transform = `translateX(${days * DAY_W}px)`;
    }
  }
  function onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const state = dragStateRef.current;
    dragStateRef.current = null;
    e.currentTarget.style.transform = "";
    if (!state || state.deltaDays === 0) return;
    const newStart = isoAddDays(result.plannedStart, state.deltaDays);
    const newFinish = isoAddDays(result.plannedFinish, state.deltaDays);
    save.mutate({
      id: activity.id,
      patch: { planned_start: newStart, planned_finish: newFinish },
    });
  }

  if (activity.activity_type === "milestone") {
    return (
      <>
        <button
          onClick={() => select(activity.id)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onContextMenu={onContextMenu}
          className={clsx(
            "gantt-bar absolute flex items-center justify-center",
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
        {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
      </>
    );
  }

  const pct = Math.max(0, Math.min(100, activity.percent_complete));

  return (
    <>
      <button
        onClick={() => select(activity.id)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={onContextMenu}
        className={clsx(
          "gantt-bar absolute overflow-hidden rounded text-[10px] text-white",
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
        <span
          className="gantt-resize-handle absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/40"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          aria-hidden
        />
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </>
  );
}
