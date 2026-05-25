"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { DbActivityHistory, UserLookupEntry } from "@/lib/schedule/types";

interface Props {
  author: UserLookupEntry | null;
  rows: DbActivityHistory[];
}

export function EditSessionGroup({ author, rows }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;

  const note = rows.find((r) => r.session_note !== null)?.session_note ?? null;
  const visibility = rows[0].visibility;  // all rows in a session share visibility
  const when = new Date(rows[0].changed_at).toLocaleString();
  const name = author?.display_name ?? "Someone";

  return (
    <div className="mb-2 rounded border border-slate-200 bg-white">
      <button
        aria-label={expanded ? "Collapse" : "Expand"}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 p-2 text-left"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <div className="flex flex-1 flex-col">
          <div className="flex items-center gap-2 text-[10px] text-slate-500">
            {author && (
              <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: author.color }} />
            )}
            <span className="font-medium text-slate-700">{name}</span>
            <span>made {rows.length} changes</span>
            <span>·</span>
            <span>{when}</span>
            <span className={`ml-auto rounded px-1 ${visibility === "internal" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
              {visibility}
            </span>
          </div>
          {note && <div className="mt-0.5 text-xs italic text-slate-600">{note}</div>}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-2 pb-2 pt-1">
          {rows.map((r) => (
            <div key={r.id} className="text-[11px] text-slate-700">
              {r.entity_type}.{r.field}: {r.old_value ?? "∅"} → {r.new_value ?? "∅"}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
