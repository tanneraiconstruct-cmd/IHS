import type { BootstrapData, DbActivity, IndexedResult } from "@/lib/schedule/types";

/**
 * Master activities (tasks + milestones, not deleted) whose engine-computed
 * planned dates intersect the window [windowStart, windowEnd] inclusive.
 * Activities without an engine result are excluded.
 */
export function mastersInWindow(
  data: BootstrapData,
  indexed: IndexedResult,
  windowStart: string,
  windowEnd: string,
): DbActivity[] {
  return data.activities.filter((a) => {
    if (a.deleted_at !== null) return false;
    if (a.activity_type !== "task" && a.activity_type !== "milestone") return false;
    const r = indexed.byActivity.get(a.id);
    if (!r) return false;
    return r.plannedStart <= windowEnd && r.plannedFinish >= windowStart;
  });
}
