import { describe, expect, it } from "vitest";
import { normalize } from "./normalize";

const PID = "00000000-0000-0000-0000-000000000001";
const ACT = (over: Partial<{ id: string; project_id: string; version: number }> = {}) => ({
  id: "a1", project_id: PID, wbs_node_id: null, name: "A",
  activity_type: "task" as const, original_duration: 1, remaining_duration: 1,
  calendar_id: null, actual_start: null, actual_finish: null,
  percent_complete: 0, responsible_company_id: null,
  early_start: null, early_finish: null, late_start: null, late_finish: null,
  planned_start: null, planned_finish: null, total_float: null, free_float: null,
  is_critical: false, version: 1, deleted_at: null, ...over,
});

describe("normalize", () => {
  it("maps an activity UPDATE payload", () => {
    const event = normalize(
      { schema: "public", table: "activities", eventType: "UPDATE",
        new: ACT({ version: 2 }), old: ACT() },
      PID,
    );
    expect(event).toEqual({ table: "activities", type: "UPDATE", new: ACT({ version: 2 }) });
  });

  it("maps an activity INSERT payload", () => {
    const event = normalize(
      { schema: "public", table: "activities", eventType: "INSERT",
        new: ACT(), old: {} },
      PID,
    );
    expect(event?.type).toBe("INSERT");
    if (event?.type === "INSERT") expect(event.new.id).toBe("a1");
  });

  it("maps an activity DELETE payload to { old: { id } }", () => {
    const event = normalize(
      { schema: "public", table: "activities", eventType: "DELETE",
        new: {}, old: ACT() },
      PID,
    );
    expect(event).toEqual({ table: "activities", type: "DELETE", old: { id: "a1" } });
  });

  it("drops an event whose new.project_id mismatches the current project", () => {
    const event = normalize(
      { schema: "public", table: "activities", eventType: "UPDATE",
        new: ACT({ project_id: "00000000-0000-0000-0000-000000000099" }), old: {} },
      PID,
    );
    expect(event).toBeNull();
  });

  it("drops an event for an unknown table", () => {
    const event = normalize(
      { schema: "public", table: "unrelated_table", eventType: "UPDATE",
        new: { id: "x" }, old: {} },
      PID,
    );
    expect(event).toBeNull();
  });

  it("maps a comment INSERT payload", () => {
    const c = { id: "c1", project_id: PID, author_user_id: "u1", body: "hi",
      parent_comment_id: null, scope: "project", target_activity_id: null,
      visibility: "shared", created_at: "2026-01-01", edited_at: null, deleted_at: null };
    const event = normalize(
      { schema: "public", table: "comments", eventType: "INSERT", new: c, old: {} },
      PID,
    );
    expect(event?.type).toBe("INSERT");
    if (event?.type === "INSERT" && event.table === "comments") {
      expect(event.new.id).toBe("c1");
    }
  });

  it("activity_constraints DELETE returns { old: { id } } via the new column", () => {
    const event = normalize(
      { schema: "public", table: "activity_constraints", eventType: "DELETE",
        new: {}, old: { id: "k1", project_id: PID, activity_id: "a1", type: "SNET", constraint_date: null } },
      PID,
    );
    expect(event).toEqual({ table: "activity_constraints", type: "DELETE", old: { id: "k1" } });
  });
});
