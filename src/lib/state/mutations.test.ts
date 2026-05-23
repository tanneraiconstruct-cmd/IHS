import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyOptimisticActivityPatch, persistVersioned } from "./mutations";
import type { DbActivity, BootstrapData } from "@/lib/schedule/types";

function makeAct(id: string, version = 1, name = "X"): DbActivity {
  return {
    id, project_id: "p", wbs_node_id: null, name,
    activity_type: "task", original_duration: 1, remaining_duration: 1,
    calendar_id: null, actual_start: null, actual_finish: null,
    percent_complete: 0, responsible_company_id: null,
    early_start: null, early_finish: null, late_start: null, late_finish: null,
    planned_start: null, planned_finish: null, total_float: null, free_float: null,
    is_critical: false, version, deleted_at: null,
  };
}

describe("applyOptimisticActivityPatch", () => {
  it("merges a partial activity patch into the cache", () => {
    const data: Partial<BootstrapData> = { activities: [makeAct("a", 1), makeAct("b", 1)] };
    const next = applyOptimisticActivityPatch(data as BootstrapData, "a", { name: "Renamed" });
    expect(next.activities.find((x) => x.id === "a")?.name).toBe("Renamed");
    expect(next.activities.find((x) => x.id === "b")?.name).toBe("X");
  });
});

describe("persistVersioned", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns ok on a first-try update success", async () => {
    const update = vi.fn().mockResolvedValue({ data: { ...makeAct("a", 2, "Renamed") }, error: null });
    const refetch = vi.fn();
    const result = await persistVersioned({
      currentVersion: 1, performUpdate: update, refetchRow: refetch,
    });
    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(refetch).not.toHaveBeenCalled();
  });

  it("retries once on null data (version conflict)", async () => {
    const update = vi.fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { ...makeAct("a", 3) }, error: null });
    const refetch = vi.fn().mockResolvedValue({ ...makeAct("a", 2) });
    const result = await persistVersioned({
      currentVersion: 1, performUpdate: update, refetchRow: refetch,
    });
    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledTimes(2);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("fails after two conflicts and surfaces the latest fresh row", async () => {
    const update = vi.fn().mockResolvedValue({ data: null, error: null });
    const fresh = makeAct("a", 7);
    const refetch = vi.fn().mockResolvedValue(fresh);
    const result = await persistVersioned({
      currentVersion: 1, performUpdate: update, refetchRow: refetch,
    });
    expect(result.ok).toBe(false);
    expect(update).toHaveBeenCalledTimes(2);
    expect(result.kind).toBe("conflict");
    if (result.ok === false && result.kind === "conflict") {
      expect(result.fresh).toEqual(fresh);
    }
  });
});
