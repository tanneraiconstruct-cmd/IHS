"use client";

import { useMemo, useState } from "react";
import type { BootstrapData, DbLookaheadTask, IndexedResult } from "@/lib/schedule/types";
import { isoAddDays } from "../Gantt/layout";
import {
  useCreateLookahead,
  useDeleteLookahead,
  useDeleteLookaheadTask,
  useInsertLookaheadTask,
  useUpdateLookaheadTask,
} from "@/lib/state/mutations";
import { NewLookaheadModal } from "./NewLookaheadModal";
import { LookaheadTaskRow } from "./LookaheadTaskRow";

type CompanyMin = { id: string; name: string };

interface Props {
  bootstrap: BootstrapData;
  indexed: IndexedResult;
  projectId: string;
  companies: CompanyMin[];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function LookaheadView({ bootstrap, indexed, projectId, companies }: Props) {
  const lookaheads = useMemo(
    () => bootstrap.lookaheads.filter((l) => l.deleted_at === null),
    [bootstrap.lookaheads],
  );

  const [selectedLookahead, setSelectedLookahead] = useState<string | null>(
    () => lookaheads[0]?.id ?? null,
  );
  const [modalOpen, setModalOpen] = useState(false);

  const createLookahead = useCreateLookahead(projectId);
  const deleteLookahead = useDeleteLookahead(projectId);
  const insertTask = useInsertLookaheadTask(projectId);
  const updateTask = useUpdateLookaheadTask(projectId);
  const deleteTask = useDeleteLookaheadTask(projectId);

  const lookahead = lookaheads.find((l) => l.id === selectedLookahead) ?? null;

  const masters = useMemo(
    () => bootstrap.activities.filter(
      (a) => a.deleted_at === null
        && (a.activity_type === "task" || a.activity_type === "milestone"),
    ),
    [bootstrap.activities],
  );

  const adhocRows = useMemo(() => {
    if (lookahead) return [];
    const start = todayIso();
    const end = isoAddDays(start, 28);
    return bootstrap.activities
      .filter((a) => a.deleted_at === null)
      .map((a) => {
        const r = indexed.byActivity.get(a.id);
        return r ? { ...a, _start: r.plannedStart, _finish: r.plannedFinish } : null;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .filter((row) => row._start <= end && row._finish >= start)
      .map((row) => ({
        id: row.id, name: row.name, start: row._start, finish: row._finish,
        pct: Math.round(row.percent_complete),
      }));
  }, [lookahead, bootstrap.activities, indexed]);

  const tasksForLookahead: DbLookaheadTask[] = useMemo(() => {
    if (!lookahead) return [];
    return bootstrap.lookaheadTasks
      .filter((t) => t.lookahead_id === lookahead.id && t.deleted_at === null);
  }, [lookahead, bootstrap.lookaheadTasks]);

  function computedStart(t: DbLookaheadTask): string | undefined {
    if (!t.master_activity_id) return t.start_date ?? undefined;
    const m = indexed.byActivity.get(t.master_activity_id);
    if (!m) return undefined;
    return isoAddDays(m.plannedStart, t.offset_start ?? 0);
  }
  function computedFinish(t: DbLookaheadTask): string | undefined {
    if (!t.master_activity_id) return t.finish_date ?? undefined;
    const m = indexed.byActivity.get(t.master_activity_id);
    if (!m) return undefined;
    return isoAddDays(m.plannedFinish, t.offset_finish ?? 0);
  }

  async function onCreateLookahead(args: { name: string; windowStart: string; windowEnd: string; type: string | null }) {
    const res = await createLookahead.mutateAsync(args);
    setModalOpen(false);
    setSelectedLookahead(res.lookaheadId);
  }

  function onAddTask() {
    if (!lookahead) return;
    insertTask.mutate({ lookaheadId: lookahead.id, masterActivityId: null, name: "" });
  }

  function onRepopulate() {
    if (!lookahead) return;
    const { plannedStart, plannedFinish } = { plannedStart: lookahead.window_start, plannedFinish: lookahead.window_end };
    const inWindow = masters.filter((a) => {
      const r = indexed.byActivity.get(a.id);
      if (!r) return false;
      return r.plannedStart <= plannedFinish && r.plannedFinish >= plannedStart;
    });
    for (const a of inWindow) {
      insertTask.mutate({ lookaheadId: lookahead.id, masterActivityId: a.id, name: a.name });
    }
  }

  function onDeleteLookahead() {
    if (!lookahead) return;
    deleteLookahead.mutate({ lookaheadId: lookahead.id });
    setSelectedLookahead(null);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs">
        <span className="text-slate-500">Lookahead:</span>
        <select
          value={selectedLookahead ?? ""}
          onChange={(e) => setSelectedLookahead(e.target.value || null)}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
        >
          <option value="">Auto (next 4 weeks of master)</option>
          {lookaheads.map((l) => (
            <option key={l.id} value={l.id}>{l.name} ({l.window_start}…{l.window_end})</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
        >
          + New Lookahead
        </button>
        {lookahead && (
          <button
            type="button"
            onClick={onDeleteLookahead}
            className="ml-auto rounded border border-slate-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
          >
            Delete Lookahead
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {!lookahead ? (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-100 text-slate-700">
              <tr>
                <th className="px-2 py-1.5 text-left">Task</th>
                <th className="w-28 px-2 py-1.5 text-left">Start</th>
                <th className="w-28 px-2 py-1.5 text-left">Finish</th>
                <th className="w-20 px-2 py-1.5 text-left">% Comp</th>
              </tr>
            </thead>
            <tbody>
              {adhocRows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="px-2 py-1.5">{r.name}</td>
                  <td className="px-2 py-1.5">{r.start}</td>
                  <td className="px-2 py-1.5">{r.finish}</td>
                  <td className="px-2 py-1.5">{r.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tasksForLookahead.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-xs text-slate-500">
            <span>No tasks yet.</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onAddTask}
                className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700"
              >
                + Add Task
              </button>
              <button
                type="button"
                onClick={onRepopulate}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
              >
                Re-populate from master
              </button>
            </div>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-100 text-slate-700">
              <tr>
                <th className="px-2 py-1.5 text-left">Master</th>
                <th className="px-2 py-1.5 text-left">Task</th>
                <th className="w-24 px-2 py-1.5 text-left">Start</th>
                <th className="w-24 px-2 py-1.5 text-left">Finish</th>
                <th className="w-14 px-2 py-1.5 text-left">Off→</th>
                <th className="w-14 px-2 py-1.5 text-left">→Off</th>
                <th className="w-24 px-2 py-1.5 text-left">Crew</th>
                <th className="w-32 px-2 py-1.5 text-left">Responsible</th>
                <th className="w-28 px-2 py-1.5 text-left">Status</th>
                <th className="w-16 px-2 py-1.5 text-left">% Comp</th>
                <th className="w-8 px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {tasksForLookahead.map((t) => (
                <LookaheadTaskRow
                  key={t.id}
                  task={t}
                  masters={masters}
                  companies={companies}
                  computedStart={computedStart(t)}
                  computedFinish={computedFinish(t)}
                  onUpdate={(id, patch) => updateTask.mutate({ taskId: id, patch })}
                  onDelete={(id) => deleteTask.mutate({ taskId: id })}
                />
              ))}
              <tr>
                <td colSpan={11} className="px-2 py-2">
                  <button
                    type="button"
                    onClick={onAddTask}
                    className="rounded border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    + Add Task
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <NewLookaheadModal
          onSubmit={onCreateLookahead}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
