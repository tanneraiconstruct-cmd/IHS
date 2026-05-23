"use client";

import { clsx } from "clsx";
import { ChevronDown, ChevronRight, Diamond } from "lucide-react";
import type { TreeRow } from "./utils";
import type { IndexedResult } from "@/lib/schedule/types";
import { useUiStore } from "@/lib/state/ui-store";

interface Props {
  row: TreeRow;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  indexed: IndexedResult;
}

export function WbsRow({ row, expanded, onToggle, indexed }: Props) {
  const selectedId = useUiStore((s) => s.selectedActivityId);
  const select = useUiStore((s) => s.select);
  const indentPx = row.depth * 16;

  if (row.kind === "group") {
    const isOpen = expanded.has(row.id);
    return (
      <button
        onClick={() => onToggle(row.id)}
        className="flex w-full items-center gap-1 border-b border-slate-100 bg-slate-50 px-2 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100"
        style={{ paddingLeft: 8 + indentPx }}
      >
        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {row.name}
      </button>
    );
  }

  const a = row.activity;
  const r = indexed.byActivity.get(a.id);
  const isMilestone = a.activity_type === "milestone";
  const isSelected = selectedId === a.id;
  return (
    <button
      onClick={() => select(a.id)}
      className={clsx(
        "flex w-full items-center gap-1 border-b border-slate-100 px-2 py-1.5 text-left text-xs hover:bg-sky-50",
        isSelected && "bg-sky-100",
        r?.isCritical && "text-red-700",
      )}
      style={{ paddingLeft: 8 + indentPx }}
    >
      {isMilestone && <Diamond size={10} className="text-amber-500" />}
      <span className="flex-1 truncate">{a.name}</span>
      <span className="ml-2 text-[10px] text-slate-500">
        {r?.plannedStart ?? "—"} → {r?.plannedFinish ?? "—"}
      </span>
    </button>
  );
}
