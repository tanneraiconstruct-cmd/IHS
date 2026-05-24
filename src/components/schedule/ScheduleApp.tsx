"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { clsx } from "clsx";
import type { BootstrapData } from "@/lib/schedule/types";
import { runRecalc } from "@/lib/state/recalc";
import { useUiStore } from "@/lib/state/ui-store";
import { ActivityTable } from "./ActivityTable/ActivityTable";
import { GanttChart } from "./Gantt/GanttChart";
import { CalendarView } from "./Calendar/CalendarView";
import { ListView } from "./List/ListView";
import { LookaheadView } from "./Lookahead/LookaheadView";
import { SidePanel } from "./SidePanel/SidePanel";
import { Toolbar } from "./Toolbar";
import { Toasts } from "./Toasts";
import { EditModeBanner } from "./EditModeBanner";

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
  const mode = useUiStore((s) => s.mode);
  const indexed = useMemo(() => runRecalc(bootstrap), [bootstrap]);

  return (
    <div className={clsx("flex h-screen flex-col bg-white", mode === "edit" && "edit-mode")}>
      <Toolbar projectName={bootstrap.project.name} problems={indexed.problems} />
      <EditModeBanner />
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-[320px] shrink-0 border-r border-slate-200 bg-slate-50 overflow-hidden">
          <ActivityTable bootstrap={bootstrap} indexed={indexed} projectId={projectId} />
        </aside>
        <main className="flex-1 overflow-hidden">
          {view === "gantt" && <GanttChart bootstrap={bootstrap} indexed={indexed} projectId={projectId} />}
          {view === "list" && <ListView bootstrap={bootstrap} indexed={indexed} />}
          {view === "calendar" && <CalendarView bootstrap={bootstrap} indexed={indexed} />}
          {view === "lookahead" && <LookaheadView bootstrap={bootstrap} indexed={indexed} />}
        </main>
        <aside className="w-[340px] shrink-0 border-l border-slate-200 bg-slate-50">
          <SidePanel bootstrap={bootstrap} projectId={projectId} />
        </aside>
      </div>
      <Toasts />
    </div>
  );
}
