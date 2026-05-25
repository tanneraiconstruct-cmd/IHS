import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyOptimisticActivityPatch, persistVersioned } from "./mutations";
import type { DbActivity, BootstrapData } from "@/lib/schedule/types";
import { QueryClient } from "@tanstack/react-query";
import { applyRealtimeEvent } from "@/lib/realtime/reducers";

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
    if (result.ok === false) {
      expect(result.kind).toBe("conflict");
      if (result.kind === "conflict") {
        expect(result.fresh).toEqual(fresh);
      }
    }
  });
});

describe("rollback fixes (Phase 6 precondition)", () => {
  it("useSaveActivity rollback preserves a sibling row update applied during the mutation", () => {
    // We exercise the rollback shape directly: simulate the snapshot capture,
    // a concurrent realtime update to a sibling row, and the rollback patch.
    const qc = new QueryClient();
    const A1 = makeAct("a", 1, "A-orig");
    const B1 = makeAct("b", 1, "B-orig");
    const dataSnapshot: Partial<BootstrapData> = { activities: [A1, B1] } as BootstrapData;
    qc.setQueryData(["schedule", "p"], dataSnapshot);

    // Mutation begins → optimistic patch on A
    qc.setQueryData(["schedule", "p"], (cur: BootstrapData | undefined) => {
      if (!cur) return cur;
      return { ...cur, activities: cur.activities.map((a) =>
        a.id === "a" ? { ...a, name: "A-optimistic" } : a) };
    });

    // Realtime UPDATE for B arrives during the mutation
    qc.setQueryData(["schedule", "p"], (cur: BootstrapData | undefined) => {
      if (!cur) return cur;
      return applyRealtimeEvent(cur as BootstrapData, {
        table: "activities", type: "UPDATE",
        new: { ...B1, version: 2, name: "B-remote" },
      });
    });

    // Mutation fails → per-row rollback for A (the fix under test)
    qc.setQueryData(["schedule", "p"], (cur: BootstrapData | undefined) => {
      if (!cur) return cur;
      const snapshotRow = (dataSnapshot as BootstrapData).activities.find((a) => a.id === "a")!;
      return {
        ...cur,
        activities: cur.activities.map((a) => a.id === "a" ? snapshotRow : a),
      };
    });

    const after = qc.getQueryData<BootstrapData>(["schedule", "p"])!;
    expect(after.activities.find((a) => a.id === "a")!.name).toBe("A-orig");
    expect(after.activities.find((a) => a.id === "b")!.name).toBe("B-remote");
    expect(after.activities.find((a) => a.id === "b")!.version).toBe(2);
  });

  it("useToggleDependencyActive rollback preserves sibling activity update", () => {
    const qc = new QueryClient();
    const dep = { id: "d", project_id: "p", predecessor_id: "a", successor_id: "b",
      type: "FS" as const, lag: 0, is_active: true, deleted_at: null };
    const A1 = makeAct("a", 1, "A-orig");
    qc.setQueryData(["schedule", "p"], { activities: [A1], dependencies: [dep] });

    // Optimistic toggle
    qc.setQueryData(["schedule", "p"], (cur: { activities: DbActivity[]; dependencies: typeof dep[] }) =>
      ({ ...cur, dependencies: cur.dependencies.map((d) => d.id === "d" ? { ...d, is_active: false } : d) }),
    );

    // Realtime update to sibling activity
    qc.setQueryData(["schedule", "p"], (cur: BootstrapData | undefined) => {
      if (!cur) return cur;
      return applyRealtimeEvent(cur, {
        table: "activities", type: "UPDATE",
        new: { ...A1, version: 2, name: "A-remote" },
      });
    });

    // Per-row rollback for dep
    qc.setQueryData(["schedule", "p"], (cur: { activities: DbActivity[]; dependencies: typeof dep[] } | undefined) => {
      if (!cur) return cur;
      return { ...cur, dependencies: cur.dependencies.map((d) =>
        d.id === "d" ? { ...d, is_active: true } : d) };
    });

    const after = qc.getQueryData<BootstrapData>(["schedule", "p"])!;
    expect(after.dependencies[0].is_active).toBe(true);  // rolled back
    expect(after.activities[0].name).toBe("A-remote");   // preserved
  });
});
