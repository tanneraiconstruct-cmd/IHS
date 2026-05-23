import { describe, it, expect } from "vitest";
import { rowsToScheduleInput } from "./load-snapshot";

describe("rowsToScheduleInput", () => {
  it("maps project + activities + deps + constraints into ScheduleInput", () => {
    const result = rowsToScheduleInput({
      project: { id: "p1", project_start: "2026-06-01", data_date: null,
                 default_calendar_id: "cal1", critical_float_threshold: 0 },
      calendars: [{ id: "cal1", working_weekdays: [1,2,3,4,5] }],
      calendar_exceptions: [],
      activities: [
        { id: "a1", activity_type: "task", name: "A1", wbs_node_id: "w1",
          original_duration: 5, remaining_duration: 5,
          calendar_id: null, actual_start: null, actual_finish: null,
          percent_complete: 0, planned_start: null, planned_finish: null,
          deleted_at: null },
        { id: "a2", activity_type: "task", name: "A2", wbs_node_id: "w1",
          original_duration: 3, remaining_duration: 3,
          calendar_id: null, actual_start: null, actual_finish: null,
          percent_complete: 0, planned_start: null, planned_finish: null,
          deleted_at: null },
      ],
      dependencies: [
        { id: "d1", predecessor_id: "a1", successor_id: "a2",
          type: "FS", lag: 0, is_active: true, deleted_at: null },
      ],
      activity_constraints: [],
    });

    expect(result.input.activities).toHaveLength(2);
    expect(result.input.dependencies).toHaveLength(1);
    expect(result.input.dependencies[0].predecessorId).toBe("a1");
    expect(result.baseVersions.activities).toEqual({ a1: 1, a2: 1 });
  });

  it("excludes soft-deleted rows from the engine input but keeps versions", () => {
    const result = rowsToScheduleInput({
      project: { id: "p1", project_start: "2026-06-01", data_date: null,
                 default_calendar_id: "cal1", critical_float_threshold: 0 },
      calendars: [{ id: "cal1", working_weekdays: [1,2,3,4,5] }],
      calendar_exceptions: [],
      activities: [
        { id: "a1", activity_type: "task", name: "A1", wbs_node_id: "w1",
          original_duration: 5, remaining_duration: 5,
          calendar_id: null, actual_start: null, actual_finish: null,
          percent_complete: 0, planned_start: null, planned_finish: null,
          deleted_at: "2026-05-01T00:00:00Z" },
      ],
      dependencies: [],
      activity_constraints: [],
    });
    expect(result.input.activities).toHaveLength(0);
  });
});
