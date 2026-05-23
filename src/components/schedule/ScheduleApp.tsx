"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { BootstrapData } from "@/lib/schedule/types";
import { runRecalc } from "@/lib/state/recalc";
import { useUiStore } from "@/lib/state/ui-store";
import { ActivityTable } from "./ActivityTable/ActivityTable";
import { GanttChart } from "./Gantt/GanttChart";
import { CalendarView } from "./Calendar/CalendarView";
import { ListView } from "./List/ListView";
import { LookaheadView } from "./Lookahead/LookaheadView";
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
      <Toolbar projectName={bootstrap.project.name} problems={indexed.problems} />
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-[320px] shrink-0 border-r border-slate-200 bg-slate-50 overflow-hidden">
          <ActivityTable bootstrap={bootstrap} indexed={indexed} />
        </aside>
        <main className="flex-1 overflow-hidden">
          {view === "gantt" && <GanttChart bootstrap={bootstrap} indexed={indexed} />}
          {view === "list" && <ListView bootstrap={bootstrap} indexed={indexed} />}
          {view === "calendar" && <CalendarView bootstrap={bootstrap} indexed={indexed} />}
          {view === "lookahead" && <LookaheadView bootstrap={bootstrap} indexed={indexed} />}
        </main>
        <aside className="w-[340px] shrink-0 border-l border-slate-200 bg-slate-50">
          <div className="p-3 text-xs text-slate-500">Side panel (Task 16)</div>
        </aside>
      </div>
    </div>
  );
}
