import type { ActivityInput, ActivityResult, IsoDate, WbsNode, WbsRollup } from "./types";

/** Internal aggregate: a date span plus duration-weighted progress. */
interface Aggregate {
  start: IsoDate | null;
  finish: IsoDate | null;
  weightedPct: number; // sum of duration * percentComplete
  totalDuration: number;
}

const EMPTY: Aggregate = { start: null, finish: null, weightedPct: 0, totalDuration: 0 };

function merge(a: Aggregate, b: Aggregate): Aggregate {
  const start =
    a.start === null ? b.start : b.start === null ? a.start : a.start < b.start ? a.start : b.start;
  const finish =
    a.finish === null ? b.finish : b.finish === null ? a.finish : a.finish > b.finish ? a.finish : b.finish;
  return {
    start,
    finish,
    weightedPct: a.weightedPct + b.weightedPct,
    totalDuration: a.totalDuration + b.totalDuration,
  };
}

/**
 * Aggregate activity results up a WBS tree. A node's start/finish span all of
 * its descendant activities; percentComplete is duration-weighted. Detached
 * activities (not under any node) are simply not aggregated.
 */
export function rollupWbs(
  nodes: WbsNode[],
  activities: ActivityInput[],
  results: ActivityResult[],
): WbsRollup[] {
  const activityById = new Map(activities.map((a) => [a.id, a]));
  const resultById = new Map(results.map((r) => [r.id, r]));
  const childNodes = new Map<string, WbsNode[]>();
  for (const node of nodes) {
    if (node.parentId !== null) {
      const siblings = childNodes.get(node.parentId) ?? [];
      siblings.push(node);
      childNodes.set(node.parentId, siblings);
    }
  }

  const memo = new Map<string, Aggregate>();

  function aggregate(node: WbsNode): Aggregate {
    const cached = memo.get(node.id);
    if (cached) return cached;

    let acc: Aggregate = EMPTY;
    for (const activityId of node.activityIds) {
      const result = resultById.get(activityId);
      const activity = activityById.get(activityId);
      if (!result || !activity) continue;
      const duration = activity.originalDuration;
      acc = merge(acc, {
        start: result.plannedStart,
        finish: result.plannedFinish,
        weightedPct: duration * (activity.percentComplete ?? 0),
        totalDuration: duration,
      });
    }
    for (const child of childNodes.get(node.id) ?? []) {
      acc = merge(acc, aggregate(child));
    }

    memo.set(node.id, acc);
    return acc;
  }

  return nodes.map((node) => {
    const agg = aggregate(node);
    return {
      nodeId: node.id,
      start: agg.start,
      finish: agg.finish,
      percentComplete: agg.totalDuration === 0 ? 0 : agg.weightedPct / agg.totalDuration,
    };
  });
}
