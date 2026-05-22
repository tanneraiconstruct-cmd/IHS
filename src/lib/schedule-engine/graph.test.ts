import { describe, expect, it } from "vitest";
import { buildGraph, detectCycles, topologicalSort } from "./graph";
import type { ActivityInput, DependencyInput } from "./types";

function act(id: string): ActivityInput {
  return { id, type: "task", originalDuration: 1, remainingDuration: 1 };
}
function dep(
  id: string, predecessorId: string, successorId: string, isActive = true,
): DependencyInput {
  return { id, predecessorId, successorId, type: "FS", lag: 0, isActive };
}

describe("buildGraph", () => {
  it("indexes successors and predecessors from active dependencies", () => {
    const g = buildGraph([act("a"), act("b")], [dep("d1", "a", "b")]);
    expect(g.successors.get("a")?.map((d) => d.successorId)).toEqual(["b"]);
    expect(g.predecessors.get("b")?.map((d) => d.predecessorId)).toEqual(["a"]);
  });
  it("ignores inactive dependencies", () => {
    const g = buildGraph([act("a"), act("b")], [dep("d1", "a", "b", false)]);
    expect(g.successors.get("a") ?? []).toEqual([]);
    expect(g.predecessors.get("b") ?? []).toEqual([]);
  });
});

describe("detectCycles", () => {
  it("returns no cycles for a DAG", () => {
    const g = buildGraph([act("a"), act("b"), act("c")], [dep("d1", "a", "b"), dep("d2", "b", "c")]);
    expect(detectCycles([act("a"), act("b"), act("c")], g)).toEqual([]);
  });
  it("detects a two-node loop", () => {
    const acts = [act("a"), act("b")];
    const g = buildGraph(acts, [dep("d1", "a", "b"), dep("d2", "b", "a")]);
    const cycles = detectCycles(acts, g);
    expect(cycles.length).toBeGreaterThan(0);
    expect([...cycles[0]].sort()).toEqual(["a", "b"]);
  });
  it("detects a self-loop", () => {
    const acts = [act("a")];
    const g = buildGraph(acts, [dep("d1", "a", "a")]);
    expect(detectCycles(acts, g).length).toBeGreaterThan(0);
  });
});

describe("topologicalSort", () => {
  it("orders predecessors before successors", () => {
    const acts = [act("c"), act("a"), act("b")];
    const g = buildGraph(acts, [dep("d1", "a", "b"), dep("d2", "b", "c")]);
    const order = topologicalSort(acts, g);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
  });
  it("includes every activity exactly once", () => {
    const acts = [act("a"), act("b"), act("c")];
    const g = buildGraph(acts, [dep("d1", "a", "c")]);
    expect([...topologicalSort(acts, g)].sort()).toEqual(["a", "b", "c"]);
  });
});
