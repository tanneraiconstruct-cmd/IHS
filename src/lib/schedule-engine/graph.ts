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
 * graph is acyclic. Iterative depth-first search (an explicit stack, so deep
 * chains cannot overflow the call stack); a back-edge to a node still on the
 * active path reveals a loop.
 */
export function detectCycles(activities: ActivityInput[], graph: ScheduleGraph): string[][] {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const a of activities) color.set(a.id, WHITE);
  const cycles: string[][] = [];

  for (const root of activities) {
    if (color.get(root.id) !== WHITE) continue;
    // frames mirror a recursion stack; `path` is the chain of GRAY nodes.
    const frames: { id: string; succIndex: number }[] = [{ id: root.id, succIndex: 0 }];
    const path: string[] = [root.id];
    color.set(root.id, GRAY);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const succs = graph.successors.get(frame.id) ?? [];
      if (frame.succIndex < succs.length) {
        const next = succs[frame.succIndex].successorId;
        frame.succIndex += 1;
        if (color.get(next) === GRAY) {
          cycles.push(path.slice(path.indexOf(next)));
        } else if (color.get(next) === WHITE) {
          color.set(next, GRAY);
          frames.push({ id: next, succIndex: 0 });
          path.push(next);
        }
      } else {
        color.set(frame.id, BLACK);
        frames.pop();
        path.pop();
      }
    }
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
