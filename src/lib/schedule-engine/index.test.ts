import { describe, expect, it } from "vitest";
import { calculate } from "./index";
import type { ActivityInput, DependencyInput, ScheduleInput } from "./types";

const week = { id: "w", workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] };

function makeInput(
  activities: ActivityInput[],
  dependencies: DependencyInput[],
  overrides: Partial<ScheduleInput> = {},
): ScheduleInput {
  return {
    projectStart: "2026-06-01", dataDate: null, defaultCalendarId: "w",
    calendars: [week], activities, dependencies, ...overrides,
  };
}
function task(id: string, duration: number): ActivityInput {
  return { id, type: "task", originalDuration: duration, remainingDuration: duration };
}
function fs(id: string, p: string, s: string): DependencyInput {
  return { id, predecessorId: p, successorId: s, type: "FS", lag: 0, isActive: true };
}

describe("calculate", () => {
  it("schedules a simple chain end to end", () => {
    const result = calculate(makeInput([task("a", 5), task("b", 3)], [fs("d", "a", "b")]));
    // A valid chain still produces open-end warnings for its first/last activity;
    // assert only that nothing errored.
    expect(result.problems.some((p) => p.severity === "error")).toBe(false);
    expect(result.projectFinish).toBe("2026-06-11");
    const a = result.activities.find((x) => x.id === "a");
    expect(a?.earlyStart).toBe("2026-06-01");
    expect(a?.isCritical).toBe(true);
    expect(a?.plannedStart).toBe(a?.earlyStart);
  });

  it("is deterministic — identical input yields identical output", () => {
    const input = makeInput([task("a", 5), task("b", 3)], [fs("d", "a", "b")]);
    expect(calculate(input)).toEqual(calculate(input));
  });

  it("does not mutate the input", () => {
    const input = makeInput([task("a", 5)], []);
    const snapshot = JSON.stringify(input);
    calculate(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("reports a cycle and returns no dates", () => {
    const result = calculate(makeInput(
      [task("a", 1), task("b", 1)],
      [fs("d1", "a", "b"), fs("d2", "b", "a")],
    ));
    expect(result.projectFinish).toBeNull();
    expect(result.activities).toEqual([]);
    expect(result.problems.some((p) => p.type === "cycle")).toBe(true);
  });

  it("reports a dangling dependency reference as invalid input", () => {
    const result = calculate(makeInput([task("a", 1)], [fs("d", "a", "ghost")]));
    expect(result.projectFinish).toBeNull();
    expect(result.problems.some((p) => p.type === "invalid_input")).toBe(true);
  });

  it("reports a negative duration as invalid input", () => {
    const result = calculate(makeInput(
      [{ id: "a", type: "task", originalDuration: -1, remainingDuration: -1 }], [],
    ));
    expect(result.problems.some((p) => p.type === "invalid_input")).toBe(true);
  });

  it("reports a missing calendar reference as invalid input", () => {
    const result = calculate(makeInput(
      [{ id: "a", type: "task", originalDuration: 1, remainingDuration: 1, calendarId: "ghost" }],
      [],
    ));
    expect(result.problems.some((p) => p.type === "invalid_input")).toBe(true);
  });

  it("warns about open-ended activities", () => {
    const result = calculate(makeInput([task("a", 1), task("b", 1)], []));
    expect(result.problems.some((p) => p.type === "open_end")).toBe(true);
  });

  it("uses LS/LF as the planned dates for an ALAP activity with float", () => {
    // b is parallel and short, so it has float and its late dates differ from
    // its early dates. ALAP must shift b's planned dates to the late window.
    const result = calculate(makeInput(
      [task("a", 5),
       { id: "b", type: "task", originalDuration: 2, remainingDuration: 2,
         constraint: { type: "ALAP", date: "2026-06-01" } },
       { id: "c", type: "milestone", originalDuration: 0, remainingDuration: 0 }],
      [fs("d1", "a", "c"), fs("d2", "b", "c")],
    ));
    const b = result.activities.find((x) => x.id === "b");
    expect(b?.lateStart).toBe("2026-06-04");
    expect(b?.plannedStart).toBe(b?.lateStart);
    expect(b?.plannedFinish).toBe(b?.lateFinish);
    expect(b?.plannedStart).not.toBe(b?.earlyStart);
  });

  it("reports a duplicate calendar id as invalid input", () => {
    const result = calculate(makeInput([task("a", 1)], [], {
      calendars: [week, { id: "w", workingWeekdays: [1, 2, 3], exceptions: [] }],
    }));
    expect(result.problems.some((p) => p.type === "invalid_input")).toBe(true);
  });

  it("reports a duplicate activity id as invalid input", () => {
    const result = calculate(makeInput([task("a", 1), task("a", 2)], []));
    expect(result.problems.some((p) => p.type === "invalid_input")).toBe(true);
  });

  it("reports a duplicate dependency id as invalid input", () => {
    const result = calculate(makeInput(
      [task("a", 1), task("b", 1)],
      [fs("d", "a", "b"), fs("d", "a", "b")],
    ));
    expect(result.problems.some((p) => p.type === "invalid_input")).toBe(true);
  });

  it("reports an out-of-range percentComplete as invalid input", () => {
    const result = calculate(makeInput(
      [{ id: "a", type: "task", originalDuration: 1, remainingDuration: 1,
         percentComplete: 150, actualStart: "2026-06-01", actualFinish: "2026-06-02" }],
      [],
    ));
    expect(result.problems.some((p) => p.type === "invalid_input")).toBe(true);
  });

  it("reports an in-progress activity with no actualStart as invalid input", () => {
    const result = calculate(makeInput(
      [{ id: "a", type: "task", originalDuration: 5, remainingDuration: 3, percentComplete: 40 }],
      [],
    ));
    expect(result.problems.some((p) => p.type === "invalid_input")).toBe(true);
  });

  it("reports a complete activity with no actualFinish as invalid input", () => {
    const result = calculate(makeInput(
      [{ id: "a", type: "task", originalDuration: 5, remainingDuration: 0,
         percentComplete: 100, actualStart: "2026-05-25" }],
      [],
    ));
    expect(result.problems.some((p) => p.type === "invalid_input")).toBe(true);
  });

  it("reports a calendar with no working weekdays as invalid input", () => {
    const result = calculate(makeInput([task("a", 1)], [], {
      calendars: [{ id: "w", workingWeekdays: [], exceptions: [] }],
    }));
    expect(result.problems.some((p) => p.type === "invalid_input")).toBe(true);
  });

  it("reports an unknown defaultCalendarId as invalid input", () => {
    const result = calculate(makeInput([task("a", 1)], [], { defaultCalendarId: "ghost" }));
    expect(result.problems.some((p) => p.type === "invalid_input")).toBe(true);
  });
});
