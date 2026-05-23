"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { BootstrapData } from "@/lib/schedule/types";
import { runRecalc } from "@/lib/state/recalc";

interface Props {
  projectId: string;
  bootstrap: BootstrapData;
}

export function ScheduleApp({ projectId, bootstrap }: Props) {
  const qc = useQueryClient();
  useEffect(() => {
    qc.setQueryData(["schedule", projectId], bootstrap);
  }, [qc, projectId, bootstrap]);

  // Stub UI for Task 9: shows we successfully fetched + ran the engine.
  const indexed = runRecalc(bootstrap);
  return (
    <div className="p-6 font-mono text-xs">
      <div className="font-semibold text-sm mb-2">
        {bootstrap.project.name} ({bootstrap.project.number ?? "no number"})
      </div>
      <div>Activities: {bootstrap.activities.length}</div>
      <div>Dependencies: {bootstrap.dependencies.length}</div>
      <div>Project finish: {indexed.projectFinish ?? "(unsolvable)"}</div>
      <div>Problems: {indexed.problems.length}</div>
    </div>
  );
}
