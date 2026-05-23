import { describe, it, expect } from "vitest";
import { buildWbsTree, flattenTree } from "./utils";
import type { DbActivity, DbWbsNode } from "@/lib/schedule/types";

const project = "p";
function node(id: string, parent: string | null, name: string, sort = 0): DbWbsNode {
  return { id, project_id: project, parent_id: parent, name, sort_order: sort, deleted_at: null };
}
function act(id: string, wbs: string | null, name: string): DbActivity {
  return {
    id, project_id: project, wbs_node_id: wbs, name,
    activity_type: "task", original_duration: 1, remaining_duration: 1,
    calendar_id: null, actual_start: null, actual_finish: null,
    percent_complete: 0, responsible_company_id: null,
    early_start: null, early_finish: null, late_start: null, late_finish: null,
    planned_start: null, planned_finish: null, total_float: null, free_float: null,
    is_critical: false, version: 1, deleted_at: null,
  };
}

describe("buildWbsTree", () => {
  it("nests children under parents and groups loose activities under their wbs node", () => {
    const nodes = [node("root", null, "Riverside"), node("phase1", "root", "Phase 1")];
    const acts = [act("a1", "phase1", "Mobilize"), act("a2", null, "Loose")];
    const tree = buildWbsTree(nodes, acts);
    expect(tree).toHaveLength(2); // root group + loose activity at top
    const root = tree[0];
    if (root.kind !== "group") throw new Error("expected root to be a group");
    expect(root.kind).toBe("group");
    const phase1 = root.children[0];
    if (phase1.kind !== "group") throw new Error("expected phase1 to be a group");
    expect(phase1.kind).toBe("group");
    expect(phase1.children[0].kind).toBe("activity");
    expect(tree[1].kind).toBe("activity"); // loose
  });
});

describe("flattenTree", () => {
  it("flattens fully when all groups are expanded", () => {
    const nodes = [node("root", null, "Riverside"), node("phase1", "root", "Phase 1")];
    const acts = [act("a1", "phase1", "Mobilize")];
    const tree = buildWbsTree(nodes, acts);
    const flat = flattenTree(tree, new Set(["root", "phase1"]));
    expect(flat.map((r) => r.kind)).toEqual(["group", "group", "activity"]);
  });

  it("hides children of collapsed groups", () => {
    const nodes = [node("root", null, "Riverside"), node("phase1", "root", "Phase 1")];
    const acts = [act("a1", "phase1", "Mobilize")];
    const tree = buildWbsTree(nodes, acts);
    const flat = flattenTree(tree, new Set([])); // nothing expanded
    expect(flat.map((r) => r.kind)).toEqual(["group"]);
  });
});
