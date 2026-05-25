"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { DbActivity, DbLookaheadTask } from "@/lib/schedule/types";

type CompanyMin = { id: string; name: string };

const STATUS_OPTIONS = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "complete", label: "Complete" },
  { value: "blocked", label: "Blocked" },
] as const;

interface Props {
  task: DbLookaheadTask;
  masters: DbActivity[];
  companies: CompanyMin[];
  computedStart?: string;
  computedFinish?: string;
  onUpdate: (id: string, patch: Partial<DbLookaheadTask>) => void;
  onDelete: (id: string) => void;
}

type EditableField =
  | "name" | "master" | "offsetStart" | "offsetFinish"
  | "startDate" | "finishDate" | "crew" | "responsibleCompany"
  | "status" | "percentComplete";

export function LookaheadTaskRow({
  task, masters, companies, computedStart, computedFinish, onUpdate, onDelete,
}: Props) {
  const [editing, setEditing] = useState<EditableField | null>(null);
  const isMasterLinked = task.master_activity_id !== null;

  function commit<T>(field: keyof DbLookaheadTask, value: T) {
    setEditing(null);
    if (task[field] === value) return;
    onUpdate(task.id, { [field]: value } as Partial<DbLookaheadTask>);
  }

  function cancel() {
    setEditing(null);
  }

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50">
      {/* Master link */}
      <td className="px-2 py-1.5 text-xs">
        {editing === "master" ? (
          <select
            autoFocus
            defaultValue={task.master_activity_id ?? ""}
            onBlur={(e) => commit("master_activity_id", e.target.value || null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLSelectElement).blur();
              if (e.key === "Escape") cancel();
            }}
            className="rounded border border-sky-300 px-1 text-xs"
          >
            <option value="">Detached</option>
            {masters.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        ) : (
          <span
            className="cursor-text text-slate-500"
            onDoubleClick={() => setEditing("master")}
          >
            {isMasterLinked
              ? (masters.find((m) => m.id === task.master_activity_id)?.name ?? "(missing)")
              : "Detached"}
          </span>
        )}
      </td>

      {/* Name */}
      <td className="px-2 py-1.5 text-xs">
        {editing === "name" ? (
          <input
            autoFocus
            defaultValue={task.name}
            onBlur={(e) => commit("name", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") cancel();
            }}
            className="w-full rounded border border-sky-300 px-1 text-xs"
          />
        ) : (
          <span className="cursor-text" onDoubleClick={() => setEditing("name")}>
            {task.name}
          </span>
        )}
      </td>

      {/* Start */}
      <td className="px-2 py-1.5 text-xs text-slate-500">
        {isMasterLinked ? (
          <span>{computedStart ?? "—"}</span>
        ) : editing === "startDate" ? (
          <input
            type="date"
            autoFocus
            defaultValue={task.start_date ?? ""}
            onBlur={(e) => commit("start_date", e.target.value || null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") cancel();
            }}
            className="rounded border border-sky-300 px-1 text-xs"
          />
        ) : (
          <span className="cursor-text" onDoubleClick={() => setEditing("startDate")}>
            {task.start_date ?? "—"}
          </span>
        )}
      </td>

      {/* Finish */}
      <td className="px-2 py-1.5 text-xs text-slate-500">
        {isMasterLinked ? (
          <span>{computedFinish ?? "—"}</span>
        ) : editing === "finishDate" ? (
          <input
            type="date"
            autoFocus
            defaultValue={task.finish_date ?? ""}
            onBlur={(e) => commit("finish_date", e.target.value || null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") cancel();
            }}
            className="rounded border border-sky-300 px-1 text-xs"
          />
        ) : (
          <span className="cursor-text" onDoubleClick={() => setEditing("finishDate")}>
            {task.finish_date ?? "—"}
          </span>
        )}
      </td>

      {/* Offset start (master-linked only) */}
      <td className="px-2 py-1.5 text-xs text-slate-500">
        {!isMasterLinked ? null : editing === "offsetStart" ? (
          <input
            type="number"
            autoFocus
            aria-label="offset start"
            defaultValue={task.offset_start ?? 0}
            onBlur={(e) => commit("offset_start", parseInt(e.target.value, 10) || 0)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") cancel();
            }}
            className="w-14 rounded border border-sky-300 px-1 text-xs"
          />
        ) : (
          <span className="cursor-text" onDoubleClick={() => setEditing("offsetStart")}>
            {task.offset_start ?? 0}d
          </span>
        )}
      </td>

      {/* Offset finish (master-linked only) */}
      <td className="px-2 py-1.5 text-xs text-slate-500">
        {!isMasterLinked ? null : editing === "offsetFinish" ? (
          <input
            type="number"
            autoFocus
            aria-label="offset finish"
            defaultValue={task.offset_finish ?? 0}
            onBlur={(e) => commit("offset_finish", parseInt(e.target.value, 10) || 0)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") cancel();
            }}
            className="w-14 rounded border border-sky-300 px-1 text-xs"
          />
        ) : (
          <span className="cursor-text" onDoubleClick={() => setEditing("offsetFinish")}>
            {task.offset_finish ?? 0}d
          </span>
        )}
      </td>

      {/* Crew */}
      <td className="px-2 py-1.5 text-xs">
        {editing === "crew" ? (
          <input
            autoFocus
            defaultValue={task.crew ?? ""}
            onBlur={(e) => commit("crew", e.target.value || null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") cancel();
            }}
            className="w-24 rounded border border-sky-300 px-1 text-xs"
          />
        ) : (
          <span className="cursor-text" onDoubleClick={() => setEditing("crew")}>
            {task.crew ?? "—"}
          </span>
        )}
      </td>

      {/* Responsible company */}
      <td className="px-2 py-1.5 text-xs">
        {editing === "responsibleCompany" ? (
          <select
            autoFocus
            defaultValue={task.responsible_company_id ?? ""}
            onBlur={(e) => commit("responsible_company_id", e.target.value || null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLSelectElement).blur();
              if (e.key === "Escape") cancel();
            }}
            className="rounded border border-sky-300 px-1 text-xs"
          >
            <option value="">—</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        ) : (
          <span className="cursor-text" onDoubleClick={() => setEditing("responsibleCompany")}>
            {companies.find((c) => c.id === task.responsible_company_id)?.name ?? "—"}
          </span>
        )}
      </td>

      {/* Status */}
      <td className="px-2 py-1.5 text-xs">
        {editing === "status" ? (
          <select
            autoFocus
            defaultValue={task.status ?? "not_started"}
            onBlur={(e) => commit("status", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLSelectElement).blur();
              if (e.key === "Escape") cancel();
            }}
            className="rounded border border-sky-300 px-1 text-xs"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ) : (
          <span className="cursor-text" onDoubleClick={() => setEditing("status")}>
            {STATUS_OPTIONS.find((o) => o.value === task.status)?.label ?? "—"}
          </span>
        )}
      </td>

      {/* % complete */}
      <td className="px-2 py-1.5 text-xs">
        {editing === "percentComplete" ? (
          <input
            type="number"
            min={0}
            max={100}
            autoFocus
            defaultValue={Math.round(task.percent_complete)}
            onBlur={(e) => {
              const n = parseInt(e.target.value, 10);
              commit("percent_complete", Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") cancel();
            }}
            className="w-14 rounded border border-sky-300 px-1 text-xs"
          />
        ) : (
          <span className="cursor-text" onDoubleClick={() => setEditing("percentComplete")}>
            {Math.round(task.percent_complete)}%
          </span>
        )}
      </td>

      {/* Delete */}
      <td className="px-2 py-1.5 text-xs">
        <button
          type="button"
          aria-label="Delete"
          onClick={() => onDelete(task.id)}
          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 size={12} />
        </button>
      </td>
    </tr>
  );
}
