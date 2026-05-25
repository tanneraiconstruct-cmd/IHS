"use client";

import { useState, useEffect, useRef } from "react";

interface Props {
  isOpen: boolean;
  changeCount: number;
  onSave: (note: string) => void;
  onClose: () => void;
}

export function SessionNoteModal({ isOpen, changeCount, onSave, onClose }: Props) {
  const [note, setNote] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setNote("");
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  function handleSave() {
    const trimmed = note.trim();
    if (trimmed.length > 0) onSave(trimmed);
    onClose();
  }

  function handleSkip() {
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[400px] rounded-md bg-white p-4 shadow-xl">
        <div className="mb-2 text-sm font-medium text-slate-800">
          Add a note for this session?
        </div>
        <div className="mb-3 text-xs text-slate-500">
          You made {changeCount} change{changeCount === 1 ? "" : "s"}. A short summary helps teammates skim the feed.
        </div>
        <textarea
          ref={textareaRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSave(); }
            if (e.key === "Escape") { e.preventDefault(); handleSkip(); }
          }}
          rows={3}
          placeholder="e.g., re-sequenced concrete to fit inspection"
          className="w-full rounded border border-slate-300 p-2 text-sm"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={handleSkip} className="rounded px-3 py-1 text-xs text-slate-600 hover:bg-slate-100">
            Skip
          </button>
          <button onClick={handleSave} className="rounded bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-700">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
