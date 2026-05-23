import type { DbActivity, DbWbsNode } from "@/lib/schedule/types";

export interface GroupRow {
  kind: "group";
  id: string;
  depth: number;
  name: string;
  children: TreeRow[];
}

export interface ActivityRow {
  kind: "activity";
  id: string;
  depth: number;
  activity: DbActivity;
}

export type TreeRow = GroupRow | ActivityRow;

export function buildWbsTree(nodes: DbWbsNode[], activities: DbActivity[]): TreeRow[] {
  const alive = nodes.filter((n) => n.deleted_at === null);
  const aliveActs = activities.filter((a) => a.deleted_at === null);
  const byParent = new Map<string | null, DbWbsNode[]>();
  for (const n of alive) {
    const arr = byParent.get(n.parent_id) ?? [];
    arr.push(n);
    byParent.set(n.parent_id, arr);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.sort_order - b.sort_order);

  const actsByNode = new Map<string | null, DbActivity[]>();
  for (const a of aliveActs) {
    const arr = actsByNode.get(a.wbs_node_id) ?? [];
    arr.push(a);
    actsByNode.set(a.wbs_node_id, arr);
  }
  for (const arr of actsByNode.values()) arr.sort((a, b) => a.name.localeCompare(b.name));

  function build(parentId: string | null, depth: number): TreeRow[] {
    const out: TreeRow[] = [];
    for (const n of byParent.get(parentId) ?? []) {
      const children = build(n.id, depth + 1);
      const ownActs = (actsByNode.get(n.id) ?? []).map<ActivityRow>((a) => ({
        kind: "activity",
        id: a.id,
        depth: depth + 1,
        activity: a,
      }));
      out.push({
        kind: "group",
        id: n.id,
        depth,
        name: n.name,
        children: [...children, ...ownActs],
      });
    }
    if (parentId === null) {
      // Loose activities with no wbs_node_id appear at top level.
      for (const a of actsByNode.get(null) ?? []) {
        out.push({ kind: "activity", id: a.id, depth: 0, activity: a });
      }
    }
    return out;
  }

  return build(null, 0);
}

export function flattenTree(tree: TreeRow[], expanded: Set<string>): TreeRow[] {
  const out: TreeRow[] = [];
  function walk(rows: TreeRow[]) {
    for (const r of rows) {
      out.push(r);
      if (r.kind === "group" && expanded.has(r.id)) walk(r.children);
    }
  }
  walk(tree);
  return out;
}
