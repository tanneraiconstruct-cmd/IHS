import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BootstrapData,
  DbActivity,
  DbActivityConstraint,
  DbActivityHistory,
  DbComment,
  DbDependency,
  DbWbsNode,
} from "@/lib/schedule/types";
import { _resetForTests, markInflight } from "./echo-set";
import { applyRealtimeEvent } from "./reducers";

const PID = "00000000-0000-0000-0000-000000000001";

function makeAct(over: Partial<DbActivity> = {}): DbActivity {
  return {
    id: "a", project_id: PID, wbs_node_id: null, name: "A",
    activity_type: "task", original_duration: 1, remaining_duration: 1,
    calendar_id: null, actual_start: null, actual_finish: null,
    percent_complete: 0, responsible_company_id: null,
    early_start: null, early_finish: null, late_start: null, late_finish: null,
    planned_start: null, planned_finish: null, total_float: null, free_float: null,
    is_critical: false, version: 1, deleted_at: null, ...over,
  };
}
function makeDep(over: Partial<DbDependency> = {}): DbDependency {
  return {
    id: "d", project_id: PID, predecessor_id: "a", successor_id: "b",
    type: "FS", lag: 0, is_active: true, deleted_at: null, ...over,
  };
}
function makeWbs(over: Partial<DbWbsNode> = {}): DbWbsNode {
  return { id: "w", project_id: PID, parent_id: null, name: "WBS",
    sort_order: 0, deleted_at: null, ...over };
}
function makeConstraint(over: Partial<DbActivityConstraint> = {}): DbActivityConstraint {
  return { id: "k", project_id: PID, activity_id: "a", type: "SNET",
    constraint_date: null, ...over };
}
function makeComment(over: Partial<DbComment> = {}): DbComment {
  return { id: "c", project_id: PID, author_user_id: "u", body: "hi",
    parent_comment_id: null, scope: "project", target_activity_id: null,
    visibility: "shared", created_at: "2026-01-01T00:00:00Z",
    edited_at: null, deleted_at: null, ...over };
}
function makeHist(over: Partial<DbActivityHistory> = {}): DbActivityHistory {
  return { id: "h", project_id: PID, edit_session_id: null,
    entity_type: "activity", entity_id: "a", field: "name",
    old_value: null, new_value: "B", changed_by: "u",
    changed_at: "2026-01-01T00:00:00Z", visibility: "shared",
    session_note: null, ...over };
}
function makeData(over: Partial<BootstrapData> = {}): BootstrapData {
  return {
    project: { id: PID, name: "P", number: null, project_start: "2026-01-01",
      data_date: null, default_calendar_id: "cal",
      critical_float_threshold: 0, comment_visibility_default: "shared" },
    calendars: [], calendarExceptions: [], wbsNodes: [], activities: [],
    dependencies: [], constraints: [], comments: [], history: [],
    lookaheads: [], lookaheadTasks: [], users: {}, ...over,
  };
}

beforeEach(() => {
  _resetForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("applyRealtimeEvent — activities", () => {
  it("accepts UPDATE when event.version > cached.version", () => {
    const data = makeData({ activities: [makeAct({ version: 1, name: "A" })] });
    const next = applyRealtimeEvent(data, {
      table: "activities", type: "UPDATE", new: makeAct({ version: 2, name: "A2" }),
    });
    expect(next.activities[0].name).toBe("A2");
  });

  it("drops UPDATE when event.version <= cached.version", () => {
    const data = makeData({ activities: [makeAct({ version: 3 })] });
    const next = applyRealtimeEvent(data, {
      table: "activities", type: "UPDATE", new: makeAct({ version: 2, name: "stale" }),
    });
    expect(next).toBe(data);  // unchanged reference
  });

  it("INSERT appends a new activity", () => {
    const data = makeData({ activities: [makeAct({ id: "a" })] });
    const next = applyRealtimeEvent(data, {
      table: "activities", type: "INSERT", new: makeAct({ id: "b" }),
    });
    expect(next.activities.map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("INSERT for existing id is a no-op (treated as duplicate)", () => {
    const data = makeData({ activities: [makeAct({ id: "a" })] });
    const next = applyRealtimeEvent(data, {
      table: "activities", type: "INSERT", new: makeAct({ id: "a" }),
    });
    expect(next).toBe(data);
  });

  it("DELETE soft-marks deleted_at", () => {
    const data = makeData({ activities: [makeAct({ id: "a", deleted_at: null })] });
    const next = applyRealtimeEvent(data, {
      table: "activities", type: "DELETE", old: { id: "a" },
    });
    expect(next.activities[0].deleted_at).not.toBeNull();
  });
});

describe("applyRealtimeEvent — dependencies (echo-suppressed INSERT)", () => {
  it("drops INSERT whose id is in the echo set", () => {
    markInflight("d1");
    const data = makeData({ dependencies: [] });
    const next = applyRealtimeEvent(data, {
      table: "dependencies", type: "INSERT", new: makeDep({ id: "d1" }),
    });
    expect(next.dependencies).toEqual([]);
  });

  it("accepts INSERT whose id is NOT in the echo set", () => {
    const data = makeData({ dependencies: [] });
    const next = applyRealtimeEvent(data, {
      table: "dependencies", type: "INSERT", new: makeDep({ id: "d2" }),
    });
    expect(next.dependencies).toHaveLength(1);
  });

  it("UPDATE replaces by id", () => {
    const data = makeData({ dependencies: [makeDep({ id: "d", lag: 0 })] });
    const next = applyRealtimeEvent(data, {
      table: "dependencies", type: "UPDATE", new: makeDep({ id: "d", lag: 5 }),
    });
    expect(next.dependencies[0].lag).toBe(5);
  });

  it("DELETE soft-marks deleted_at", () => {
    const data = makeData({ dependencies: [makeDep({ id: "d", deleted_at: null })] });
    const next = applyRealtimeEvent(data, {
      table: "dependencies", type: "DELETE", old: { id: "d" },
    });
    expect(next.dependencies[0].deleted_at).not.toBeNull();
  });
});

describe("applyRealtimeEvent — activity_constraints", () => {
  it("INSERT appends; UPDATE replaces; DELETE removes (no deleted_at column)", () => {
    let data = makeData({ constraints: [] });
    data = applyRealtimeEvent(data, {
      table: "activity_constraints", type: "INSERT", new: makeConstraint({ id: "k" }),
    });
    expect(data.constraints).toHaveLength(1);

    data = applyRealtimeEvent(data, {
      table: "activity_constraints", type: "UPDATE",
      new: makeConstraint({ id: "k", constraint_date: "2026-02-01" }),
    });
    expect(data.constraints[0].constraint_date).toBe("2026-02-01");

    data = applyRealtimeEvent(data, {
      table: "activity_constraints", type: "DELETE", old: { id: "k" },
    });
    expect(data.constraints).toEqual([]);
  });

  it("drops INSERT in echo set", () => {
    markInflight("k1");
    const data = makeData({ constraints: [] });
    const next = applyRealtimeEvent(data, {
      table: "activity_constraints", type: "INSERT", new: makeConstraint({ id: "k1" }),
    });
    expect(next.constraints).toEqual([]);
  });
});

describe("applyRealtimeEvent — wbs_nodes", () => {
  it("INSERT appends; UPDATE replaces; DELETE soft-marks; echo-suppressed", () => {
    markInflight("w1");
    let data = makeData({ wbsNodes: [] });
    data = applyRealtimeEvent(data, {
      table: "wbs_nodes", type: "INSERT", new: makeWbs({ id: "w1" }),
    });
    expect(data.wbsNodes).toEqual([]);  // echo dropped

    data = applyRealtimeEvent(data, {
      table: "wbs_nodes", type: "INSERT", new: makeWbs({ id: "w2", name: "x" }),
    });
    expect(data.wbsNodes).toHaveLength(1);

    data = applyRealtimeEvent(data, {
      table: "wbs_nodes", type: "UPDATE", new: makeWbs({ id: "w2", name: "y" }),
    });
    expect(data.wbsNodes[0].name).toBe("y");

    data = applyRealtimeEvent(data, {
      table: "wbs_nodes", type: "DELETE", old: { id: "w2" },
    });
    expect(data.wbsNodes[0].deleted_at).not.toBeNull();
  });
});

describe("applyRealtimeEvent — comments", () => {
  it("INSERT prepends to head (newest first to match read path)", () => {
    const data = makeData({ comments: [makeComment({ id: "c0" })] });
    const next = applyRealtimeEvent(data, {
      table: "comments", type: "INSERT", new: makeComment({ id: "c1" }),
    });
    expect(next.comments.map((c) => c.id)).toEqual(["c1", "c0"]);
  });

  it("drops INSERT in echo set", () => {
    markInflight("c1");
    const data = makeData({ comments: [] });
    const next = applyRealtimeEvent(data, {
      table: "comments", type: "INSERT", new: makeComment({ id: "c1" }),
    });
    expect(next.comments).toEqual([]);
  });

  it("UPDATE replaces; DELETE soft-marks", () => {
    let data = makeData({ comments: [makeComment({ id: "c", body: "old" })] });
    data = applyRealtimeEvent(data, {
      table: "comments", type: "UPDATE", new: makeComment({ id: "c", body: "new" }),
    });
    expect(data.comments[0].body).toBe("new");
    data = applyRealtimeEvent(data, {
      table: "comments", type: "DELETE", old: { id: "c" },
    });
    expect(data.comments[0].deleted_at).not.toBeNull();
  });
});

describe("applyRealtimeEvent — activity_history", () => {
  it("INSERT appends (no echo filtering, audit trail)", () => {
    const data = makeData({ history: [makeHist({ id: "h0" })] });
    const next = applyRealtimeEvent(data, {
      table: "activity_history", type: "INSERT", new: makeHist({ id: "h1" }),
    });
    expect(next.history.map((h) => h.id)).toEqual(["h1", "h0"]);  // newest first
  });
});
