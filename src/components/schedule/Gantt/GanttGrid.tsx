"use client";

import { DAY_W, ROW_H } from "./layout";

interface Props {
  totalDays: number;
  rowCount: number;
}

export function GanttGrid({ totalDays, rowCount }: Props) {
  return (
    <div
      aria-hidden
      className="absolute inset-0"
      style={{
        backgroundImage: `linear-gradient(to right, #f1f5f9 1px, transparent 1px), linear-gradient(to bottom, #f1f5f9 1px, transparent 1px)`,
        backgroundSize: `${DAY_W}px 100%, 100% ${ROW_H}px`,
        width: totalDays * DAY_W,
        height: rowCount * ROW_H,
      }}
    />
  );
}
