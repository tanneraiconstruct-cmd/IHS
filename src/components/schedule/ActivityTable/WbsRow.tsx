"use client";

import { clsx } from "clsx";
import { ChevronDown, ChevronRight, Diamond } from "lucide-react";
import { useRef, useState } from "react";
import type { TreeRow } from "./utils";
import type { IndexedResult } from "@/lib/schedule/types";
import { useSaveActivity } from "@/lib/state/mutations";
import { useUiStore } from "@/lib/state/ui-store";

interface Props {
  row: TreeRow;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  indexed: IndexedResult;
  projectId: string;
}

export function WbsRow({ row, expanded, onToggle, indexed, projectId }: Props) {
  const selectedId = useUiStore((s) => s.selectedActivityId);
  const select = useUiStore((s) => s.select);
  const mode = useUiStore((s) => s.mode);
  const save = useSaveActivity(projectId);
  const indentPx = row.depth * 16;
  const [editingField, setEditingField] = useState<"name" | "duration" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
  const canEdit = mode === "edit";

  function commitName(value: string) {
    setEditingField(null);
    const trimmed = value.trim();
    if (trimmed && trimmed !== a.name) {
      save.mutate({ id: a.id, patch: { name: trimmed } });
    }
  }
  function commitDuration(value: string) {
    setEditingField(null);
    const n = parseInt(value, 10);
    if (Number.isNaN(n) || n < 0) return;
    if (n !== a.original_duration) {
      save.mutate({
        id: a.id,
        patch: { original_duration: n, remaining_duration: n },
      });
    }
  }

  return (
    <div
      className={clsx(
        "flex w-full items-center gap-1 border-b border-slate-100 px-2 py-1.5 text-xs",
        isSelected ? "bg-sky-100" : "hover:bg-sky-50",
        r?.isCritical && "text-red-700",
      )}
      style={{ paddingLeft: 8 + indentPx }}
      onClick={() => editingField === null && select(a.id)}
    >
      {isMilestone && <Diamond size={10} className="text-amber-500" />}
      {editingField === "name" ? (
        <input
          ref={inputRef}
          defaultValue={a.name}
          autoFocus
          onBlur={(e) => commitName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditingField(null);
          }}
          className="flex-1 rounded border border-sky-300 px-1 text-xs"
        />
      ) : (
        <span
          data-testid="activity-name-cell"
          className="flex-1 truncate"
          onDoubleClick={() => canEdit && setEditingField("name")}
        >
          {a.name}
        </span>
      )}
      {!isMilestone && (
        editingField === "duration" ? (
          <input
            type="number"
            min={0}
            defaultValue={a.original_duration}
            autoFocus
            onBlur={(e) => commitDuration(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditingField(null);
            }}
            className="w-12 rounded border border-sky-300 px-1 text-right text-[10px]"
          />
        ) : (
          <span
            className="ml-2 cursor-text text-[10px] text-slate-500"
            onDoubleClick={() => canEdit && setEditingField("duration")}
          >
            {a.original_duration}d
          </span>
        )
      )}
      <span className="ml-2 text-[10px] text-slate-500">
        {r?.plannedStart ?? "—"} → {r?.plannedFinish ?? "—"}
      </span>
    </div>
  );
}
