import { describe, it, expect } from "vitest";
import { buildEngineInput, indexResult } from "./recalc";
import { calculate } from "@/lib/schedule-engine";
import type { BootstrapData } from "@/lib/schedule/types";

const calendarId = "11111111-1111-1111-1111-111111111111";
const projectId = "70000000-0000-0000-0000-000000000000";

function makeBootstrap(overrides: Partial<BootstrapData> = {}): BootstrapData {
  return {
    project: {
      id: projectId,
      name: "Riverside Office Build",
      number: "RIV-2026",
      project_start: "2026-05-04",
      data_date: null,
      default_calendar_id: calendarId,
      critical_float_threshold: 0,
      comment_visibility_default: "internal",
    },
    calendars: [
      { id: calendarId, project_id: projectId, name: "Standard 5-Day", working_weekdays: [1, 2, 3, 4, 5], is_default: true },
    ],
    calendarExceptions: [],
    wbsNodes: [],
    activities: [
      {
        id: "act-A", project_id: projectId, wbs_node_id: null, name: "Mobilize",
        activity_type: "task", original_duration: 5, remaining_duration: 5,
        calendar_id: null, actual_start: null, actual_finish: null,
        percent_complete: 0, responsible_company_id: null,
        early_start: null, early_finish: null, late_start: null, late_finish: null,
        planned_start: null, planned_finish: null, total_float: null, free_float: null,
        is_critical: false, version: 1, deleted_at: null,
      },
      {
        id: "act-B", project_id: projectId, wbs_node_id: null, name: "Pour Foundations",
        activity_type: "task", original_duration: 5, remaining_duration: 5,
        calendar_id: null, actual_start: null, actual_finish: null,
        percent_complete: 0, responsible_company_id: null,
        early_start: null, early_finish: null, late_start: null, late_finish: null,
        planned_start: null, planned_finish: null, total_float: null, free_float: null,
        is_critical: false, version: 1, deleted_at: null,
      },
    ],
    dependencies: [
      {
        id: "dep-AB", project_id: projectId, predecessor_id: "act-A", successor_id: "act-B",
        type: "FS", lag: 0, is_active: true, deleted_at: null,
      },
    ],
    constraints: [],
    comments: [],
    history: [],
    lookaheads: [],
    lookaheadTasks: [],
    ...overrides,
  };
}

describe("buildEngineInput", () => {
  it("translates DB rows into a runnable ScheduleInput", () => {
    const input = buildEngineInput(makeBootstrap());
    expect(input.projectStart).toBe("2026-05-04");
    expect(input.defaultCalendarId).toBe(calendarId);
    expect(input.activities).toHaveLength(2);
    expect(input.dependencies).toHaveLength(1);
    expect(input.activities[0].type).toBe("task");
  });

  it("excludes deleted activities and dependencies", () => {
    const b = makeBootstrap();
    b.activities[1].deleted_at = "2026-05-22T00:00:00Z";
    b.dependencies[0].deleted_at = "2026-05-22T00:00:00Z";
    const input = buildEngineInput(b);
    expect(input.activities).toHaveLength(1);
    expect(input.dependencies).toHaveLength(0);
  });

  it("drops summary/level_of_effort activities (engine cannot consume them)", () => {
    const b = makeBootstrap();
    b.activities[0].activity_type = "summary";
    const input = buildEngineInput(b);
    expect(input.activities).toHaveLength(1);
    expect(input.activities[0].id).toBe("act-B");
  });
});

describe("indexResult", () => {
  it("produces an end-to-end engine result keyed by activity id", () => {
    const result = calculate(buildEngineInput(makeBootstrap()));
    const indexed = indexResult(result);
    expect(indexed.projectFinish).not.toBeNull();
    expect(indexed.byActivity.get("act-A")?.plannedFinish).toBeDefined();
    expect(indexed.byActivity.get("act-B")?.plannedStart).toBeDefined();
  });
});
