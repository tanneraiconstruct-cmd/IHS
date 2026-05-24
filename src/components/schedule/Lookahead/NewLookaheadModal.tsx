"use client";

import { useEffect, useState } from "react";

interface SubmitArgs {
  name: string;
  windowStart: string;
  windowEnd: string;
  type: string | null;
}

interface Props {
  onSubmit: (args: SubmitArgs) => void;
  onClose: () => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function NewLookaheadModal({ onSubmit, onClose }: Props) {
  const [name, setName] = useState("");
  const [windowStart, setWindowStart] = useState(todayIso());
  const [windowEnd, setWindowEnd] = useState(addDays(todayIso(), 28));
  const [type, setType] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canSubmit = name.trim().length > 0 && windowStart <= windowEnd;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      name: name.trim(),
      windowStart,
      windowEnd,
      type: type.trim() === "" ? null : type.trim(),
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-lg"
      >
        <h2 className="mb-3 text-sm font-semibold text-slate-900">New Lookahead</h2>

        <label htmlFor="name" className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Name</span>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
          />
        </label>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <label htmlFor="window-start" className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Window start</span>
            <input
              id="window-start"
              type="date"
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
            />
          </label>
          <label htmlFor="window-end" className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Window end</span>
            <input
              id="window-end"
              type="date"
              value={windowEnd}
              onChange={(e) => setWindowEnd(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
            />
          </label>
        </div>

        <label htmlFor="type" className="mb-4 block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Type (optional)</span>
          <input
            id="type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="e.g. weekly, rolling"
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
          />
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
