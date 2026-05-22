import type { ActivityInput, DependencyInput } from "./types";

export interface ScheduleGraph {
  /** activityId -> incoming active dependencies. */
  predecessors: Map<string, DependencyInput[]>;
  /** activityId -> outgoing active dependencies. */
  successors: Map<string, DependencyInput[]>;
}

export function buildGraph(
  activities: ActivityInput[],
  dependencies: DependencyInput[],
): ScheduleGraph {
  const predecessors = new Map<string, DependencyInput[]>();
  const successors = new Map<string, DependencyInput[]>();
  for (const a of activities) {
    predecessors.set(a.id, []);
    successors.set(a.id, []);
  }
  for (const d of dependencies) {
    if (!d.isActive) continue;
    successors.get(d.predecessorId)?.push(d);
    predecessors.get(d.successorId)?.push(d);
  }
  return { predecessors, successors };
}

/**
 * Returns one ordered activity-id list per detected cycle. Empty when the
 * graph is acyclic. Uses a depth-first search; a back-edge to a node still on
 * the recursion stack reveals a loop.
 */
export function detectCycles(activities: ActivityInput[], graph: ScheduleGraph): string[][] {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const a of activities) color.set(a.id, WHITE);
  const stack: string[] = [];
  const cycles: string[][] = [];

  function visit(id: string): void {
    color.set(id, GRAY);
    stack.push(id);
    for (const d of graph.successors.get(id) ?? []) {
      const next = d.successorId;
      if (color.get(next) === GRAY) {
        const from = stack.indexOf(next);
        cycles.push(stack.slice(from));
      } else if (color.get(next) === WHITE) {
        visit(next);
      }
    }
    stack.pop();
    color.set(id, BLACK);
  }

  for (const a of activities) {
    if (color.get(a.id) === WHITE) visit(a.id);
  }
  return cycles;
}

/**
 * Activity ids ordered so every predecessor precedes its successors (Kahn's
 * algorithm). Assumes the graph is acyclic — call detectCycles first.
 */
export function topologicalSort(activities: ActivityInput[], graph: ScheduleGraph): string[] {
  const inDegree = new Map<string, number>();
  for (const a of activities) {
    inDegree.set(a.id, (graph.predecessors.get(a.id) ?? []).length);
  }
  const queue = activities.filter((a) => inDegree.get(a.id) === 0).map((a) => a.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const d of graph.successors.get(id) ?? []) {
      const next = d.successorId;
      const remaining = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  return order;
}
