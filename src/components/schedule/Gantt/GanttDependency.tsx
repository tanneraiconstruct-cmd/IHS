"use client";

import { clsx } from "clsx";
import { useToggleDependencyActive } from "@/lib/state/mutations";
import { useUiStore } from "@/lib/state/ui-store";
import { dependencyPath, type BarRect } from "./layout";

interface Props {
  id: string;
  pred: BarRect;
  succ: BarRect;
  active: boolean;
  projectId: string;
}

export function GanttDependency({ id, pred, succ, active, projectId }: Props) {
  const mode = useUiStore((s) => s.mode);
  const toggle = useToggleDependencyActive(projectId);
  return (
    <path
      d={dependencyPath(pred, succ)}
      fill="none"
      stroke="#475569"
      strokeWidth={1.2}
      strokeDasharray={active ? undefined : "3 3"}
      className={clsx(
        active ? "opacity-100" : "opacity-60",
        mode === "edit" && "pointer-events-auto cursor-pointer",
      )}
      markerEnd="url(#gantt-arrow)"
      onDoubleClick={() => mode === "edit" && toggle.mutate(id)}
    />
  );
}
