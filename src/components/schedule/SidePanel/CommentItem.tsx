"use client";

import { clsx } from "clsx";
import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { DbComment, UserLookupEntry } from "@/lib/schedule/types";

interface Props {
  comment: DbComment;
  author: UserLookupEntry | null;
  isOwn: boolean;
  onEdit: (newBody: string) => void;
  onDelete: () => void;
}

export function CommentItem({ comment, author, isOwn, onEdit, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);

  const isDeleted = comment.deleted_at !== null;
  const wasEdited = comment.edited_at !== null && !isDeleted;

  function save() {
    if (draft.trim().length > 0 && draft !== comment.body) {
      onEdit(draft);
    }
    setEditing(false);
  }

  return (
    <div className="mb-2 rounded border border-slate-200 bg-white p-2">
      <div className="mb-1 flex items-center gap-2 text-[10px] text-slate-500">
        {author && (
          <span className="inline-flex items-center gap-1">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: author.color }}
            />
            <span className="font-medium text-slate-700">{author.display_name}</span>
          </span>
        )}
        <span className={clsx("rounded px-1", comment.visibility === "internal" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700")}>
          {comment.visibility}
        </span>
        <span>{new Date(comment.created_at).toLocaleString()}</span>
        {wasEdited && <span className="italic">(edited)</span>}
      </div>

      {isDeleted ? (
        <div className="italic text-slate-400">[deleted by author]</div>
      ) : editing ? (
        <div className="flex flex-col gap-1">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full rounded border border-slate-200 p-1 text-xs"
            autoFocus
          />
          <div className="flex gap-1">
            <button onClick={save} className="rounded bg-sky-600 px-2 py-0.5 text-[11px] text-white hover:bg-sky-700">Save</button>
            <button onClick={() => { setDraft(comment.body); setEditing(false); }} className="rounded px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100">Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className="text-slate-700 whitespace-pre-wrap">{comment.body}</div>
          {isOwn && (
            <div className="mt-1 flex gap-1 text-slate-400">
              <button onClick={() => setEditing(true)} aria-label="Edit" className="hover:text-slate-700">
                <Pencil size={12} />
              </button>
              <button onClick={onDelete} aria-label="Delete" className="hover:text-rose-600">
                <Trash2 size={12} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
