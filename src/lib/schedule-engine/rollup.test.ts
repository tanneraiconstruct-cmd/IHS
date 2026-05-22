import { describe, expect, it } from "vitest";
import { rollupWbs } from "./rollup";
import type { ActivityInput, ActivityResult, WbsNode } from "./types";

function activity(id: string, duration: number, pct: number): ActivityInput {
  return { id, type: "task", originalDuration: duration, remainingDuration: duration, percentComplete: pct };
}
function result(id: string, start: string, finish: string): ActivityResult {
  return {
    id, earlyStart: start, earlyFinish: finish, lateStart: start, lateFinish: finish,
    plannedStart: start, plannedFinish: finish, totalFloat: 0, freeFloat: 0, isCritical: true,
  };
}

describe("rollupWbs", () => {
  it("rolls a node's dates from the span of its activities", () => {
    const nodes: WbsNode[] = [{ id: "n1", parentId: null, activityIds: ["a", "b"] }];
    const activities = [activity("a", 5, 100), activity("b", 5, 0)];
    const results = [result("a", "2026-06-01", "2026-06-08"), result("b", "2026-06-08", "2026-06-15")];
    const [node] = rollupWbs(nodes, activities, results);
    expect(node.start).toBe("2026-06-01");
    expect(node.finish).toBe("2026-06-15");
  });

  it("computes a duration-weighted percent complete", () => {
    // a: 5 days @ 100%, b: 15 days @ 0% => (5*100 + 15*0) / 20 = 25
    const nodes: WbsNode[] = [{ id: "n1", parentId: null, activityIds: ["a", "b"] }];
    const activities = [activity("a", 5, 100), activity("b", 15, 0)];
    const results = [result("a", "2026-06-01", "2026-06-08"), result("b", "2026-06-08", "2026-06-29")];
    const [node] = rollupWbs(nodes, activities, results);
    expect(node.percentComplete).toBe(25);
  });

  it("rolls a parent node up from its child nodes", () => {
    const nodes: WbsNode[] = [
      { id: "root", parentId: null, activityIds: [] },
      { id: "c1", parentId: "root", activityIds: ["a"] },
      { id: "c2", parentId: "root", activityIds: ["b"] },
    ];
    const activities = [activity("a", 5, 100), activity("b", 5, 0)];
    const results = [result("a", "2026-06-01", "2026-06-08"), result("b", "2026-06-10", "2026-06-17")];
    const byId = new Map(rollupWbs(nodes, activities, results).map((r) => [r.nodeId, r]));
    expect(byId.get("root")?.start).toBe("2026-06-01");
    expect(byId.get("root")?.finish).toBe("2026-06-17");
    expect(byId.get("root")?.percentComplete).toBe(50);
  });

  it("returns null dates and zero percent for an empty node", () => {
    const nodes: WbsNode[] = [{ id: "n1", parentId: null, activityIds: [] }];
    const [node] = rollupWbs(nodes, [], []);
    expect(node).toEqual({ nodeId: "n1", start: null, finish: null, percentComplete: 0 });
  });
});
