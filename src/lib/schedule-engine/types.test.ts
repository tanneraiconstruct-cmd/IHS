import { describe, expect, it } from "vitest";
import type {
  ScheduleInput,
  ScheduleResult,
  ActivityInput,
  DependencyInput,
  Calendar,
} from "./types";

describe("types contract", () => {
  it("a minimal ScheduleInput is assignable", () => {
    const cal: Calendar = { id: "c1", workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] };
    const act: ActivityInput = { id: "a", type: "task", originalDuration: 1, remainingDuration: 1 };
    const dep: DependencyInput = {
      id: "d", predecessorId: "a", successorId: "b", type: "FS", lag: 0, isActive: true,
    };
    const input: ScheduleInput = {
      projectStart: "2026-06-01",
      dataDate: null,
      defaultCalendarId: "c1",
      calendars: [cal],
      activities: [act],
      dependencies: [dep],
    };
    expect(input.activities).toHaveLength(1);
  });

  it("a ScheduleResult shape is assignable", () => {
    const result: ScheduleResult = { activities: [], projectFinish: null, problems: [] };
    expect(result.problems).toEqual([]);
  });
});
