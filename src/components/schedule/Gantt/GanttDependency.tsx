"use client";

import { clsx } from "clsx";
import { dependencyPath, type BarRect } from "./layout";

interface Props {
  pred: BarRect;
  succ: BarRect;
  active: boolean;
}

export function GanttDependency({ pred, succ, active }: Props) {
  return (
    <path
      d={dependencyPath(pred, succ)}
      fill="none"
      stroke="#475569"
      strokeWidth={1.2}
      strokeDasharray={active ? undefined : "3 3"}
      className={clsx(active ? "opacity-100" : "opacity-60")}
      markerEnd="url(#gantt-arrow)"
    />
  );
}
