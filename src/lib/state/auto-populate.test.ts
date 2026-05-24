import { describe, it, expect } from "vitest";
import { mastersInWindow } from "./auto-populate";
import type { BootstrapData, IndexedResult, DbActivity } from "@/lib/schedule/types";
import type { ScheduleResult } from "@/lib/schedule-engine";

function act(over: Partial<DbActivity> = {}): DbActivity {
  return {
    id: over.id ?? "a", project_id: "p", wbs_node_id: null, name: "A",
    activity_type: "task", original_duration: 1, remaining_duration: 1,
    calendar_id: null, actual_start: null, actual_finish: null,
    percent_complete: 0, responsible_company_id: null,
    early_start: null, early_finish: null, late_start: null, late_finish: null,
    planned_start: null, planned_finish: null, total_float: null, free_float: null,
    is_critical: false, version: 1, deleted_at: null, ...over,
  };
}

function indexed(...rows: { id: string; plannedStart: string; plannedFinish: string }[]): IndexedResult {
  const byActivity = new Map<string, ScheduleResult["activities"][number]>();
  for (const r of rows) {
    byActivity.set(r.id, {
      id: r.id,
      earlyStart: r.plannedStart, earlyFinish: r.plannedFinish,
      lateStart: r.plannedStart, lateFinish: r.plannedFinish,
      plannedStart: r.plannedStart, plannedFinish: r.plannedFinish,
      totalFloat: 0, freeFloat: 0, isCritical: false,
    });
  }
  return { byActivity, projectFinish: null, problems: [] };
}

function bs(activities: DbActivity[]): BootstrapData {
  return {
    project: { id: "p", name: "P", number: null, project_start: "2026-05-01",
      data_date: null, default_calendar_id: "c", critical_float_threshold: 0,
      comment_visibility_default: "internal" },
    calendars: [], calendarExceptions: [], wbsNodes: [],
    activities, dependencies: [], constraints: [], comments: [], history: [],
    lookaheads: [], lookaheadTasks: [],
  };
}

describe("mastersInWindow", () => {
  it("includes a master that starts before window and ends inside", () => {
    const b = bs([act({ id: "a" })]);
    const r = mastersInWindow(b, indexed({ id: "a", plannedStart: "2026-05-01", plannedFinish: "2026-05-10" }),
      "2026-05-05", "2026-05-15");
    expect(r.map((x) => x.id)).toEqual(["a"]);
  });

  it("includes a master fully inside the window", () => {
    const b = bs([act({ id: "a" })]);
    const r = mastersInWindow(b, indexed({ id: "a", plannedStart: "2026-05-06", plannedFinish: "2026-05-10" }),
      "2026-05-05", "2026-05-15");
    expect(r.map((x) => x.id)).toEqual(["a"]);
  });

  it("excludes a master fully before the window", () => {
    const b = bs([act({ id: "a" })]);
    const r = mastersInWindow(b, indexed({ id: "a", plannedStart: "2026-05-01", plannedFinish: "2026-05-04" }),
      "2026-05-05", "2026-05-15");
    expect(r).toHaveLength(0);
  });

  it("excludes a master fully after the window", () => {
    const b = bs([act({ id: "a" })]);
    const r = mastersInWindow(b, indexed({ id: "a", plannedStart: "2026-05-20", plannedFinish: "2026-05-25" }),
      "2026-05-05", "2026-05-15");
    expect(r).toHaveLength(0);
  });

  it("excludes summary and level_of_effort activities", () => {
    const b = bs([act({ id: "a", activity_type: "summary" }), act({ id: "b", activity_type: "level_of_effort" })]);
    const r = mastersInWindow(b,
      indexed({ id: "a", plannedStart: "2026-05-06", plannedFinish: "2026-05-10" },
              { id: "b", plannedStart: "2026-05-06", plannedFinish: "2026-05-10" }),
      "2026-05-05", "2026-05-15");
    expect(r).toHaveLength(0);
  });

  it("excludes soft-deleted activities", () => {
    const b = bs([act({ id: "a", deleted_at: "2026-05-01T00:00:00Z" })]);
    const r = mastersInWindow(b, indexed({ id: "a", plannedStart: "2026-05-06", plannedFinish: "2026-05-10" }),
      "2026-05-05", "2026-05-15");
    expect(r).toHaveLength(0);
  });

  it("excludes activities with no engine result", () => {
    const b = bs([act({ id: "a" })]);
    const r = mastersInWindow(b, indexed(), "2026-05-05", "2026-05-15");
    expect(r).toHaveLength(0);
  });

  it("includes milestones (single-day) at the window boundary", () => {
    const b = bs([act({ id: "m", activity_type: "milestone", original_duration: 0, remaining_duration: 0 })]);
    const r = mastersInWindow(b, indexed({ id: "m", plannedStart: "2026-05-15", plannedFinish: "2026-05-15" }),
      "2026-05-05", "2026-05-15");
    expect(r.map((x) => x.id)).toEqual(["m"]);
  });
});
