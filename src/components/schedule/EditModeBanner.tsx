"use client";

import { Edit3 } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUiStore } from "@/lib/state/ui-store";
import { useSetSessionNote } from "@/lib/state/mutations";
import { SessionNoteModal } from "./SessionNoteModal";
import type { BootstrapData } from "@/lib/schedule/types";

interface Props {
  projectId: string;
}

export function EditModeBanner({ projectId }: Props) {
  const mode = useUiStore((s) => s.mode);
  const editSessionId = useUiStore((s) => s.editSessionId);
  const exit = useUiStore((s) => s.exitEditMode);
  const qc = useQueryClient();
  const setSessionNote = useSetSessionNote(projectId);
  const [showModal, setShowModal] = useState(false);

  if (mode !== "edit") return null;

  const data = qc.getQueryData<BootstrapData>(["schedule", projectId]);
  const changeCount = data?.history.filter((h) => h.edit_session_id === editSessionId).length ?? 0;

  function handleDoneClick() {
    if (changeCount === 0 || !editSessionId) {
      exit();
      return;
    }
    setShowModal(true);
  }

  function handleSave(note: string) {
    if (editSessionId) {
      setSessionNote.mutate({ editSessionId, note });
    }
    // exit happens via onClose
  }

  function handleClose() {
    setShowModal(false);
    exit();
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-amber-300 bg-amber-100 px-4 py-1.5 text-xs text-amber-900">
        <div className="flex items-center gap-2">
          <Edit3 size={14} />
          <span className="font-medium">Edit mode</span>
          <span className="text-amber-800/80">
            Changes persist on release. Discard only reverts local view — already-saved changes stay.
          </span>
        </div>
        <button
          onClick={handleDoneClick}
          className="rounded bg-amber-500 px-2 py-1 text-xs font-medium text-white hover:bg-amber-600"
        >
          Done
        </button>
      </div>
      <SessionNoteModal
        isOpen={showModal}
        changeCount={changeCount}
        onSave={handleSave}
        onClose={handleClose}
      />
    </>
  );
}
