import { describe, it, expect } from "vitest";
import {
  applyOptimisticLookaheadPatch,
  applyOptimisticLookaheadTaskPatch,
  softDeleteFromCache,
} from "./mutations";
import type { BootstrapData, DbLookahead, DbLookaheadTask } from "@/lib/schedule/types";

function lookahead(over: Partial<DbLookahead> = {}): DbLookahead {
  return {
    id: over.id ?? "L1", project_id: "p", name: "L1",
    window_start: "2026-05-01", window_end: "2026-05-28",
    type: null, source_mode: "from_master", deleted_at: null, ...over,
  };
}

function task(over: Partial<DbLookaheadTask> = {}): DbLookaheadTask {
  return {
    id: over.id ?? "T1", lookahead_id: "L1", master_activity_id: null, name: "T1",
    offset_start: null, offset_finish: null, start_date: null, finish_date: null,
    crew: null, responsible_company_id: null, status: null,
    percent_complete: 0, constraints_cleared: false, readiness_notes: null,
    deleted_at: null, ...over,
  };
}

function makeData(over: Partial<BootstrapData> = {}): BootstrapData {
  return {
    project: { id: "p", name: "P", number: null, project_start: "2026-05-01",
      data_date: null, default_calendar_id: "c", critical_float_threshold: 0,
      comment_visibility_default: "internal" },
    calendars: [], calendarExceptions: [], wbsNodes: [],
    activities: [], dependencies: [], constraints: [],
    comments: [], history: [],
    lookaheads: [lookahead()],
    lookaheadTasks: [task()],
    ...over,
  };
}

describe("applyOptimisticLookaheadPatch", () => {
  it("merges a patch into the target lookahead and leaves others alone", () => {
    const data = makeData({ lookaheads: [lookahead({ id: "L1" }), lookahead({ id: "L2" })] });
    const next = applyOptimisticLookaheadPatch(data, "L1", { name: "Renamed" });
    expect(next.lookaheads.find((l) => l.id === "L1")?.name).toBe("Renamed");
    expect(next.lookaheads.find((l) => l.id === "L2")?.name).toBe("L1");
  });
});

describe("applyOptimisticLookaheadTaskPatch", () => {
  it("merges a patch into the target task and leaves others alone", () => {
    const data = makeData({ lookaheadTasks: [task({ id: "T1" }), task({ id: "T2" })] });
    const next = applyOptimisticLookaheadTaskPatch(data, "T1", { percent_complete: 50 });
    expect(next.lookaheadTasks.find((t) => t.id === "T1")?.percent_complete).toBe(50);
    expect(next.lookaheadTasks.find((t) => t.id === "T2")?.percent_complete).toBe(0);
  });
});

describe("softDeleteFromCache", () => {
  it("soft-deletes a lookahead by id", () => {
    const data = makeData();
    const next = softDeleteFromCache(data, "lookahead", "L1", "2026-05-23T00:00:00Z");
    expect(next.lookaheads[0].deleted_at).toBe("2026-05-23T00:00:00Z");
  });

  it("soft-deletes a lookahead_task by id", () => {
    const data = makeData();
    const next = softDeleteFromCache(data, "lookaheadTask", "T1", "2026-05-23T00:00:00Z");
    expect(next.lookaheadTasks[0].deleted_at).toBe("2026-05-23T00:00:00Z");
  });

  it("leaves unrelated rows alone", () => {
    const data = makeData({
      lookaheads: [lookahead({ id: "L1" }), lookahead({ id: "L2" })],
    });
    const next = softDeleteFromCache(data, "lookahead", "L1", "2026-05-23T00:00:00Z");
    expect(next.lookaheads.find((l) => l.id === "L1")?.deleted_at).toBe("2026-05-23T00:00:00Z");
    expect(next.lookaheads.find((l) => l.id === "L2")?.deleted_at).toBeNull();
  });
});
