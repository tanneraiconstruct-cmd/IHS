"use client";

import { clsx } from "clsx";
import { useState } from "react";
import { usePostComment } from "@/lib/state/mutations";
import { useUiStore } from "@/lib/state/ui-store";

interface Props {
  projectId: string;
  defaultVisibility?: "internal" | "shared";
}

export function CommentComposer({ projectId, defaultVisibility = "internal" }: Props) {
  const selectedId = useUiStore((s) => s.selectedActivityId);
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"internal" | "shared">(defaultVisibility);
  const post = usePostComment(projectId);

  async function submit() {
    if (!body.trim()) return;
    await post.mutateAsync({
      body: body.trim(),
      scope: selectedId ? "activity" : "project",
      targetActivityId: selectedId,
      visibility,
    });
    setBody("");
  }

  return (
    <div className="border-t border-slate-200 p-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={`Add a ${selectedId ? "activity" : "project"} comment…`}
        rows={2}
        className="w-full rounded border border-slate-200 p-1.5 text-xs"
      />
      <div className="mt-1 flex items-center justify-between">
        <div className="flex gap-1 text-[10px]">
          {(["internal", "shared"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setVisibility(v)}
              className={clsx(
                "rounded px-2 py-0.5",
                visibility === v
                  ? v === "internal"
                    ? "bg-amber-200 text-amber-900"
                    : "bg-emerald-200 text-emerald-900"
                  : "text-slate-500 hover:bg-slate-100",
              )}
            >
              {v}
            </button>
          ))}
        </div>
        <button
          onClick={submit}
          disabled={!body.trim() || post.isPending}
          className="rounded bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-700 disabled:opacity-50"
        >
          Post
        </button>
      </div>
    </div>
  );
}
