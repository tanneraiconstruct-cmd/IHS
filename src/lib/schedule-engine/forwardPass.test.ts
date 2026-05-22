import { describe, expect, it } from "vitest";
import { forwardPass } from "./forwardPass";
import { buildGraph, topologicalSort } from "./graph";
import type { ActivityInput, DependencyInput, ScheduleInput } from "./types";

const week = { id: "w", workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] };

function makeInput(
  activities: ActivityInput[],
  dependencies: DependencyInput[],
  overrides: Partial<ScheduleInput> = {},
): ScheduleInput {
  return {
    projectStart: "2026-06-01", // Monday
    dataDate: null,
    defaultCalendarId: "w",
    calendars: [week],
    activities,
    dependencies,
    ...overrides,
  };
}

function run(input: ScheduleInput) {
  const graph = buildGraph(input.activities, input.dependencies);
  return forwardPass(input, graph, topologicalSort(input.activities, graph));
}

function task(id: string, duration: number): ActivityInput {
  return { id, type: "task", originalDuration: duration, remainingDuration: duration };
}
function fs(id: string, p: string, s: string, lag = 0): DependencyInput {
  return { id, predecessorId: p, successorId: s, type: "FS", lag, isActive: true };
}

describe("forwardPass", () => {
  it("schedules a lone activity from the project start", () => {
    const r = run(makeInput([task("a", 5)], []));
    expect(r.earlyDates.get("a")).toEqual({ es: "2026-06-01", ef: "2026-06-08" });
  });

  it("a milestone has zero duration so EF equals ES", () => {
    const r = run(makeInput([{ id: "m", type: "milestone", originalDuration: 0, remainingDuration: 0 }], []));
    expect(r.earlyDates.get("m")).toEqual({ es: "2026-06-01", ef: "2026-06-01" });
  });

  it("an FS successor starts at the predecessor's early finish", () => {
    const r = run(makeInput([task("a", 5), task("b", 3)], [fs("d", "a", "b")]));
    expect(r.earlyDates.get("b")?.es).toBe("2026-06-08");
    expect(r.earlyDates.get("b")?.ef).toBe("2026-06-11");
  });

  it("an FS successor honors positive lag", () => {
    const r = run(makeInput([task("a", 5), task("b", 3)], [fs("d", "a", "b", 2)]));
    expect(r.earlyDates.get("b")?.es).toBe("2026-06-10");
  });

  it("an SS successor starts with the predecessor plus lag", () => {
    const r = run(makeInput(
      [task("a", 5), task("b", 3)],
      [{ id: "d", predecessorId: "a", successorId: "b", type: "SS", lag: 2, isActive: true }],
    ));
    expect(r.earlyDates.get("b")?.es).toBe("2026-06-03");
  });

  it("takes the latest requirement across multiple predecessors", () => {
    const r = run(makeInput(
      [task("a", 2), task("b", 8), task("c", 1)],
      [fs("d1", "a", "c"), fs("d2", "b", "c")],
    ));
    // b finishes latest (2026-06-11); c starts then
    expect(r.earlyDates.get("c")?.es).toBe("2026-06-11");
  });

  it("ignores inactive dependencies", () => {
    const r = run(makeInput(
      [task("a", 5), task("b", 3)],
      [{ id: "d", predecessorId: "a", successorId: "b", type: "FS", lag: 0, isActive: false }],
    ));
    expect(r.earlyDates.get("b")?.es).toBe("2026-06-01");
  });

  it("reports the project finish as the latest early finish", () => {
    const r = run(makeInput([task("a", 5), task("b", 3)], [fs("d", "a", "b")]));
    expect(r.projectFinish).toBe("2026-06-11");
  });

  it("floors a not-started activity at the data date", () => {
    const r = run(makeInput([task("a", 5)], [], { dataDate: "2026-06-15" }));
    expect(r.earlyDates.get("a")?.es).toBe("2026-06-15");
  });

  it("pins a completed activity to its actual dates", () => {
    const r = run(makeInput(
      [{ id: "a", type: "task", originalDuration: 5, remainingDuration: 0,
         percentComplete: 100, actualStart: "2026-05-25", actualFinish: "2026-05-29" }],
      [], { dataDate: "2026-06-15" },
    ));
    expect(r.earlyDates.get("a")).toEqual({ es: "2026-05-25", ef: "2026-05-29" });
  });

  it("flags an MSO constraint that logic cannot honor", () => {
    const r = run(makeInput(
      [task("a", 5),
       { id: "b", type: "task", originalDuration: 3, remainingDuration: 3,
         constraint: { type: "MSO", date: "2026-06-03" } }],
      [fs("d", "a", "b")],
    ));
    expect(r.earlyDates.get("b")?.es).toBe("2026-06-08"); // logic wins
    expect(r.violations.some((p) => p.type === "constraint_violation" && p.activityIds.includes("b")))
      .toBe(true);
  });
});
