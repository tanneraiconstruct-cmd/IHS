import { describe, expect, it } from "vitest";
import { backwardPass } from "./backwardPass";
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
function fs(id: string, p: string, s: string, lag = 0): DependencyInput {
  return { id, predecessorId: p, successorId: s, type: "FS", lag, isActive: true };
}

function run(input: ScheduleInput) {
  const graph = buildGraph(input.activities, input.dependencies);
  const topo = topologicalSort(input.activities, graph);
  const fwd = forwardPass(input, graph, topo);
  const bwd = backwardPass(input, graph, topo, fwd.projectFinish);
  return { fwd, bwd };
}

describe("backwardPass", () => {
  it("seeds a lone activity's late finish at the project finish", () => {
    const { fwd, bwd } = run(makeInput([task("a", 5)], []));
    expect(bwd.lateDates.get("a")?.lf).toBe(fwd.projectFinish);
    expect(bwd.lateDates.get("a")?.ls).toBe("2026-06-01");
  });

  it("makes a chain's predecessor late finish meet the successor late start", () => {
    const { bwd } = run(makeInput([task("a", 5), task("b", 3)], [fs("d", "a", "b")]));
    // b: LF = projectFinish 2026-06-11, LS = 2026-06-08; a: LF = 2026-06-08
    expect(bwd.lateDates.get("b")?.ls).toBe("2026-06-08");
    expect(bwd.lateDates.get("a")?.lf).toBe("2026-06-08");
  });

  it("takes the most restrictive requirement across multiple successors", () => {
    // a feeds b (long) and c (short); a's LF is bounded by the tighter successor
    const { bwd } = run(makeInput(
      [task("a", 2), task("b", 8), task("c", 2)],
      [fs("d1", "a", "b"), fs("d2", "a", "c")],
    ));
    // b drives projectFinish; c has float. a.LF = min(b.LS, c.LS) = b.LS
    const bLs = bwd.lateDates.get("b")?.ls as string;
    const cLs = bwd.lateDates.get("c")?.ls as string;
    expect(bwd.lateDates.get("a")?.lf).toBe(bLs < cLs ? bLs : cLs);
  });

  it("an FNLT constraint pulls the late finish in", () => {
    const { bwd } = run(makeInput(
      [{ id: "a", type: "task", originalDuration: 5, remainingDuration: 5,
         constraint: { type: "FNLT", date: "2026-06-05" } }],
      [],
    ));
    expect(bwd.lateDates.get("a")?.lf).toBe("2026-06-05");
  });

  it("flags an MFO constraint that logic cannot honor", () => {
    // a -> b chain; b has MFO earlier than its successors permit is not possible
    // here a has MFO far in the future while logic finish is earlier
    const { bwd } = run(makeInput(
      [task("a", 2), { id: "b", type: "task", originalDuration: 2, remainingDuration: 2,
        constraint: { type: "MFO", date: "2026-06-30" } }],
      [fs("d", "b", "a")],
    ));
    expect(bwd.violations.some((p) => p.type === "constraint_violation" && p.activityIds.includes("b")))
      .toBe(true);
  });

  it("an FF predecessor's late finish aligns with the successor's late finish", () => {
    const { bwd } = run(makeInput(
      [task("a", 5), task("b", 3)],
      [{ id: "d", predecessorId: "a", successorId: "b", type: "FF", lag: 0, isActive: true }],
    ));
    expect(bwd.lateDates.get("a")).toEqual({ ls: "2026-06-01", lf: "2026-06-08" });
    expect(bwd.lateDates.get("b")).toEqual({ ls: "2026-06-03", lf: "2026-06-08" });
  });

  it("an SS predecessor's late dates are driven back through the start link", () => {
    const { bwd } = run(makeInput(
      [task("a", 5), task("b", 4)],
      [{ id: "d", predecessorId: "a", successorId: "b", type: "SS", lag: 2, isActive: true }],
    ));
    expect(bwd.lateDates.get("a")).toEqual({ ls: "2026-06-01", lf: "2026-06-08" });
  });

  it("an SF predecessor's late finish is driven by the successor late finish", () => {
    const { bwd } = run(makeInput(
      [task("a", 2), task("b", 3)],
      [{ id: "d", predecessorId: "a", successorId: "b", type: "SF", lag: 10, isActive: true }],
    ));
    expect(bwd.lateDates.get("a")).toEqual({ ls: "2026-06-01", lf: "2026-06-03" });
  });

  it("honors negative lag (a lead) in the backward direction", () => {
    const { bwd } = run(makeInput([task("a", 5), task("b", 3)], [fs("d", "a", "b", -2)]));
    expect(bwd.lateDates.get("a")?.lf).toBe("2026-06-08");
    expect(bwd.lateDates.get("b")?.ls).toBe("2026-06-04");
  });

  it("pins a completed activity's late dates to its actuals", () => {
    const { bwd } = run(makeInput(
      [{ id: "a", type: "task", originalDuration: 5, remainingDuration: 0,
         percentComplete: 100, actualStart: "2026-05-25", actualFinish: "2026-05-29" }],
      [],
    ));
    expect(bwd.lateDates.get("a")).toEqual({ ls: "2026-05-25", lf: "2026-05-29" });
  });
});
