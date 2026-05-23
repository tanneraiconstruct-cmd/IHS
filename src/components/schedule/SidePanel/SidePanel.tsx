"use client";

import { clsx } from "clsx";
import { useMemo, useState } from "react";
import type { BootstrapData } from "@/lib/schedule/types";
import { useUiStore } from "@/lib/state/ui-store";

type Filter = "all" | "comments" | "history";

interface Props {
  bootstrap: BootstrapData;
}

interface FeedItem {
  id: string;
  kind: "comment" | "history";
  at: string;
  visibility: "internal" | "shared";
  body: string;
  meta?: string;
}

export function SidePanel({ bootstrap }: Props) {
  const selectedId = useUiStore((s) => s.selectedActivityId);
  const [filter, setFilter] = useState<Filter>("all");

  const items: FeedItem[] = useMemo(() => {
    const comments = bootstrap.comments
      .filter((c) => c.deleted_at === null)
      .filter((c) =>
        selectedId
          ? c.scope === "activity" && c.target_activity_id === selectedId
          : c.scope === "project",
      )
      .map<FeedItem>((c) => ({
        id: c.id, kind: "comment", at: c.created_at,
        visibility: c.visibility, body: c.body,
      }));

    const history = bootstrap.history
      .filter((h) =>
        selectedId ? h.entity_id === selectedId : true,
      )
      .map<FeedItem>((h) => ({
        id: h.id, kind: "history", at: h.changed_at,
        visibility: h.visibility,
        body: `${h.entity_type}.${h.field}: ${h.old_value ?? "∅"} → ${h.new_value ?? "∅"}`,
        meta: h.session_note ?? undefined,
      }));

    const all = [...comments, ...history];
    const filtered = filter === "all" ? all : all.filter((i) => i.kind === filter.slice(0, -1));
    filtered.sort((a, b) => b.at.localeCompare(a.at));
    return filtered;
  }, [bootstrap, selectedId, filter]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 p-3">
        <div className="text-xs font-medium text-slate-700">
          {selectedId ? "Activity feed" : "Project feed"}
        </div>
        <div className="mt-2 flex gap-1 text-[10px]">
          {(["all", "comments", "history"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx(
                "rounded px-2 py-0.5",
                filter === f ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-100",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 text-xs">
        {items.length === 0 ? (
          <div className="p-2 text-slate-400">No items.</div>
        ) : (
          items.map((it) => (
            <div key={it.id} className="mb-2 rounded border border-slate-200 bg-white p-2">
              <div className="mb-1 flex items-center gap-2 text-[10px] text-slate-500">
                <span className={clsx("rounded px-1", it.kind === "comment" ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-600")}>
                  {it.kind}
                </span>
                <span className={clsx("rounded px-1", it.visibility === "internal" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700")}>
                  {it.visibility}
                </span>
                <span>{new Date(it.at).toLocaleString()}</span>
              </div>
              <div className="text-slate-700 whitespace-pre-wrap">{it.body}</div>
              {it.meta && <div className="mt-1 text-[10px] text-slate-500">{it.meta}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
