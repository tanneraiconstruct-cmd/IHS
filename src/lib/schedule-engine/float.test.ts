import { describe, expect, it } from "vitest";
import { backwardPass } from "./backwardPass";
import { computeFloat } from "./float";
import { forwardPass } from "./forwardPass";
import { buildGraph, topologicalSort } from "./graph";
import type { ActivityInput, DependencyInput, ScheduleInput } from "./types";

const week = { id: "w", workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] };

function makeInput(activities: ActivityInput[], dependencies: DependencyInput[]): ScheduleInput {
  return {
    projectStart: "2026-06-01", dataDate: null, defaultCalendarId: "w",
    calendars: [week], activities, dependencies,
  };
}
function task(id: string, duration: number): ActivityInput {
  return { id, type: "task", originalDuration: duration, remainingDuration: duration };
}
function fs(id: string, p: string, s: string): DependencyInput {
  return { id, predecessorId: p, successorId: s, type: "FS", lag: 0, isActive: true };
}

function run(input: ScheduleInput) {
  const graph = buildGraph(input.activities, input.dependencies);
  const topo = topologicalSort(input.activities, graph);
  const fwd = forwardPass(input, graph, topo);
  const bwd = backwardPass(input, graph, topo, fwd.projectFinish);
  return computeFloat(input, graph, fwd.earlyDates, bwd.lateDates, 0);
}

describe("computeFloat", () => {
  it("gives a single chain zero total float and marks it critical", () => {
    const float = run(makeInput([task("a", 5), task("b", 3)], [fs("d", "a", "b")]));
    expect(float.get("a")?.totalFloat).toBe(0);
    expect(float.get("a")?.isCritical).toBe(true);
    expect(float.get("b")?.isCritical).toBe(true);
  });

  it("gives a parallel shorter activity positive total float", () => {
    // a(2) and b(8) both feed c(1). a has 6 working days of float.
    const float = run(makeInput(
      [task("a", 2), task("b", 8), task("c", 1)],
      [fs("d1", "a", "c"), fs("d2", "b", "c")],
    ));
    expect(float.get("a")?.totalFloat).toBe(6);
    expect(float.get("a")?.isCritical).toBe(false);
    expect(float.get("b")?.totalFloat).toBe(0);
    expect(float.get("b")?.isCritical).toBe(true);
  });

  it("computes free float as slack to the nearest successor", () => {
    const float = run(makeInput(
      [task("a", 2), task("b", 8), task("c", 1)],
      [fs("d1", "a", "c"), fs("d2", "b", "c")],
    ));
    // a finishes early; c cannot start until b finishes, so a has free float too
    expect(float.get("a")?.freeFloat).toBe(6);
  });

  it("an activity with no successors takes free float equal to total float", () => {
    const float = run(makeInput([task("a", 2), task("b", 8)], []));
    expect(float.get("a")?.freeFloat).toBe(float.get("a")?.totalFloat);
  });
});
