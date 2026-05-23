"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { BootstrapData } from "@/lib/schedule/types";
import { runRecalc } from "@/lib/state/recalc";
import { useUiStore } from "@/lib/state/ui-store";
import { Toolbar } from "./Toolbar";

interface Props {
  projectId: string;
  bootstrap: BootstrapData;
}

export function ScheduleApp({ projectId, bootstrap }: Props) {
  const qc = useQueryClient();
  useEffect(() => {
    qc.setQueryData(["schedule", projectId], bootstrap);
  }, [qc, projectId, bootstrap]);

  const view = useUiStore((s) => s.view);
  const indexed = useMemo(() => runRecalc(bootstrap), [bootstrap]);

  return (
    <div className="flex h-screen flex-col bg-white">
      <Toolbar projectName={bootstrap.project.name} problemCount={indexed.problems.length} />
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-[320px] shrink-0 border-r border-slate-200 bg-slate-50">
          <div className="p-3 text-xs text-slate-500">Activity table (Task 11)</div>
        </aside>
        <main className="flex-1 overflow-hidden">
          <div className="p-3 text-xs text-slate-500">
            Main view: <span className="font-medium text-slate-800">{view}</span>{" "}
            (Tasks 13–15). Engine ran: project finish ={" "}
            {indexed.projectFinish ?? "(unsolvable)"}, problems = {indexed.problems.length}.
          </div>
        </main>
        <aside className="w-[340px] shrink-0 border-l border-slate-200 bg-slate-50">
          <div className="p-3 text-xs text-slate-500">Side panel (Task 16)</div>
        </aside>
      </div>
    </div>
  );
}
