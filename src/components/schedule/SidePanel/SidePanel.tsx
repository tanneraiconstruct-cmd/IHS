"use client";

import { clsx } from "clsx";
import { useEffect, useMemo, useState } from "react";
import type { BootstrapData, DbActivityHistory } from "@/lib/schedule/types";
import { useUiStore } from "@/lib/state/ui-store";
import { useUpdateComment, useSoftDeleteComment } from "@/lib/state/mutations";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { CommentComposer } from "./CommentComposer";
import { CommentItem } from "./CommentItem";
import { EditSessionGroup } from "./EditSessionGroup";

type KindFilter = "all" | "comments" | "history";

interface Props {
  bootstrap: BootstrapData;
  projectId: string;
}

type FeedEntry =
  | { kind: "comment"; commentId: string; at: string; visibility: "internal" | "shared" }
  | { kind: "history-single"; row: DbActivityHistory; at: string; visibility: "internal" | "shared" }
  | { kind: "history-group"; rows: DbActivityHistory[]; at: string; visibility: "internal" | "shared"; authorId: string };

export function SidePanel({ bootstrap, projectId }: Props) {
  const selectedId = useUiStore((s) => s.selectedActivityId);
  const visibilityFilter = useUiStore((s) => s.visibilityFilter);
  const setVisibilityFilter = useUiStore((s) => s.setVisibilityFilter);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

  const updateComment = useUpdateComment(projectId);
  const softDeleteComment = useSoftDeleteComment(projectId);

  const [currentUserId, setCurrentUserId] = useState<string>("");
  useEffect(() => {
    const sb = createSupabaseBrowserClient();
    void sb.auth.getUser().then(({ data: { user } }) => { if (user) setCurrentUserId(user.id); });
  }, []);

  const entries = useMemo<FeedEntry[]>(() => {
    const comments = bootstrap.comments
      .filter((c) =>
        selectedId
          ? c.scope === "activity" && c.target_activity_id === selectedId
          : c.scope === "project",
      )
      .map<FeedEntry>((c) => ({
        kind: "comment", commentId: c.id, at: c.created_at, visibility: c.visibility,
      }));

    const historyRows = bootstrap.history.filter((h) =>
      selectedId ? h.entity_id === selectedId : true,
    );
    const bySession = new Map<string, DbActivityHistory[]>();
    const singles: DbActivityHistory[] = [];
    for (const h of historyRows) {
      if (!h.edit_session_id) { singles.push(h); continue; }
      const arr = bySession.get(h.edit_session_id) ?? [];
      arr.push(h);
      bySession.set(h.edit_session_id, arr);
    }

    const historyEntries: FeedEntry[] = [];
    for (const [, rows] of bySession) {
      if (rows.length === 1) {
        const r = rows[0];
        historyEntries.push({ kind: "history-single", row: r, at: r.changed_at, visibility: r.visibility });
      } else {
        const sorted = [...rows].sort((a, b) => a.changed_at.localeCompare(b.changed_at));
        const head = sorted[0];
        // All rows in one edit_session_id are written together by insertHistoryRows
        // with a single visibility value, so head.visibility represents the group.
        historyEntries.push({
          kind: "history-group", rows: sorted, at: head.changed_at,
          visibility: head.visibility, authorId: head.changed_by,
        });
      }
    }
    for (const r of singles) {
      historyEntries.push({ kind: "history-single", row: r, at: r.changed_at, visibility: r.visibility });
    }

    const all: FeedEntry[] = [...comments, ...historyEntries];
    const filtered = all.filter((e) => {
      if (kindFilter === "comments" && e.kind !== "comment") return false;
      if (kindFilter === "history" && e.kind === "comment") return false;
      if (visibilityFilter !== "all" && e.visibility !== visibilityFilter) return false;
      return true;
    });
    filtered.sort((a, b) => b.at.localeCompare(a.at));
    return filtered;
  }, [bootstrap, selectedId, kindFilter, visibilityFilter]);

  // External users can't see internal at all — hide the chip.
  // We infer external from absence of any internal items in the bootstrap (RLS-filtered).
  const showInternalChip = bootstrap.comments.some((c) => c.visibility === "internal")
                        || bootstrap.history.some((h) => h.visibility === "internal");

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 p-3">
        <div className="text-xs font-medium text-slate-700">
          {selectedId ? "Activity feed" : "Project feed"}
        </div>
        <div className="mt-2 flex gap-1 text-[10px]">
          {(["all", "comments", "history"] as KindFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setKindFilter(f)}
              className={clsx(
                "rounded px-2 py-0.5",
                kindFilter === f ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-100",
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="mt-1 flex gap-1 text-[10px]" data-testid="visibility-filter">
          {(["all", ...(showInternalChip ? ["internal"] as const : []), "shared"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setVisibilityFilter(v)}
              className={clsx(
                "rounded px-2 py-0.5",
                visibilityFilter === v ? "bg-slate-700 text-white" : "text-slate-600 hover:bg-slate-100",
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 text-xs">
        {entries.length === 0 ? (
          <div className="p-2 text-slate-400">No items.</div>
        ) : (
          <ul className="m-0 list-none p-0">
            {entries.map((e) => {
              if (e.kind === "comment") {
                const c = bootstrap.comments.find((x) => x.id === e.commentId)!;
                const author = bootstrap.users[c.author_user_id] ?? null;
                return (
                  <li key={`c-${c.id}`}>
                    <CommentItem
                      comment={c}
                      author={author}
                      isOwn={c.author_user_id === currentUserId}
                      onEdit={(body) => updateComment.mutate({ commentId: c.id, body })}
                      onDelete={() => softDeleteComment.mutate({ commentId: c.id })}
                    />
                  </li>
                );
              }
              if (e.kind === "history-group") {
                const author = bootstrap.users[e.authorId] ?? null;
                return (
                  <li key={`g-${e.rows[0].edit_session_id}`}>
                    <EditSessionGroup author={author} rows={e.rows} />
                  </li>
                );
              }
              const r = e.row;
              const author = bootstrap.users[r.changed_by] ?? null;
              return (
                <li key={`h-${r.id}`}>
                  <div className="mb-2 rounded border border-slate-200 bg-white p-2">
                    <div className="mb-1 flex items-center gap-2 text-[10px] text-slate-500">
                      {author && <>
                        <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: author.color }} />
                        <span className="font-medium text-slate-700">{author.display_name}</span>
                      </>}
                      <span className={clsx("rounded px-1", r.visibility === "internal" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700")}>
                        {r.visibility}
                      </span>
                      <span>{new Date(r.changed_at).toLocaleString()}</span>
                    </div>
                    <div className="text-slate-700">
                      {r.entity_type}.{r.field}: {r.old_value ?? "∅"} → {r.new_value ?? "∅"}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <CommentComposer projectId={projectId} defaultVisibility={bootstrap.project.comment_visibility_default} />
    </div>
  );
}
