"use client";

import { useMemo, useState } from "react";
import type { BootstrapData, IndexedResult } from "@/lib/schedule/types";
import { buildWbsTree, flattenTree } from "./utils";
import { WbsRow } from "./WbsRow";

interface Props {
  bootstrap: BootstrapData;
  indexed: IndexedResult;
  projectId: string;
}

export function ActivityTable({ bootstrap, indexed, projectId }: Props) {
  const tree = useMemo(
    () => buildWbsTree(bootstrap.wbsNodes, bootstrap.activities),
    [bootstrap.wbsNodes, bootstrap.activities],
  );
  const allGroupIds = useMemo(() => {
    const ids: string[] = [];
    function walk(rows: ReturnType<typeof buildWbsTree>) {
      for (const r of rows) if (r.kind === "group") {
        ids.push(r.id);
        walk(r.children);
      }
    }
    walk(tree);
    return ids;
  }, [tree]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(allGroupIds));
  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const flat = flattenTree(tree, expanded);

  return (
    <div className="h-full overflow-y-auto">
      {flat.map((row) => (
        <WbsRow
          key={`${row.kind}-${row.id}`}
          row={row}
          expanded={expanded}
          onToggle={toggle}
          indexed={indexed}
          projectId={projectId}
        />
      ))}
    </div>
  );
}
