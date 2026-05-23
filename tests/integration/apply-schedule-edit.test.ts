// Integration tests: exercise the apply pipeline (orchestrator + RPC + DB)
// directly with an authed Supabase client. We skip the HTTP route handler
// here — its job is just to parse JSON + forward to applyScheduleEdit, and
// @supabase/ssr cookie auth in a Node test process is more brittle than it's
// worth. The HTTP layer gets covered by a manual smoke from a real frontend.

import { describe, it, expect, beforeAll } from "vitest";
import { applyScheduleEdit } from "@/lib/schedule-server/apply-schedule-edit";
import { seedFixture, asUser, service, SCHED_ID, PROJECT_ID, WBS_ID } from "./setup";

let scheduler: Awaited<ReturnType<typeof asUser>>;
let schedulerId: string;

beforeAll(async () => {
  await seedFixture();
  scheduler = await asUser(SCHED_ID);
  schedulerId = (await scheduler.auth.getUser()).data.user!.id;
});

describe("applyScheduleEdit pipeline (integration)", () => {
  it("creates an activity, runs the engine, persists computed dates", async () => {
    const response = await applyScheduleEdit({
      client: scheduler,
      projectId: PROJECT_ID,
      editSessionId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      actingUserId: schedulerId,
      ops: [{
        type: "createActivity", tempId: "t1",
        wbsNodeId: WBS_ID, name: "Pour Slab",
        activityType: "task", originalDuration: 5,
      }],
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const newId = (response.data.temp_id_map as Record<string, string>).t1;
    expect(newId).toBeTruthy();

    const s = service();
    const persisted = await s.from("activities")
      .select("id, planned_start, planned_finish, version")
      .eq("id", newId).single();
    expect(persisted.data?.planned_start).toBeTruthy();
    expect(persisted.data?.planned_finish).toBeTruthy();
    expect(persisted.data?.version).toBe(1);
  });

  it("returns STALE_STATE when base_versions don't match", async () => {
    const s = service();
    const acts = await s.from("activities").select("id, version")
      .eq("project_id", PROJECT_ID).limit(1);
    const target = acts.data![0];

    // Bump the row's version out-of-band so the next request's base_version is stale.
    await s.from("activities").update({ version: target.version + 5 }).eq("id", target.id);

    const { data } = await scheduler.rpc("apply_schedule_edit", {
      p_payload: {
        project_id: PROJECT_ID,
        request_id: crypto.randomUUID(),
        acting_user_id: schedulerId,
        edit_session_id: crypto.randomUUID(),
        intent_op_count: 0,
        base_versions: {
          project_version: 1,
          activities: { [target.id]: target.version },   // stale
          dependencies: {}, constraints: {},
        },
        writes: {
          activity_inserts: [], activity_updates: [], activity_soft_deletes: [],
          dependency_inserts: [], dependency_updates: [], dependency_soft_deletes: [],
          constraint_upserts: [], constraint_deletes: [],
          project_patch: {}, project_problems: [],
        },
        history_rows: [],
      },
    });
    expect((data as { error?: string }).error).toBe("STALE_STATE");
  });

  it("returns ENGINE_CYCLE when ops would create a cycle", async () => {
    const response = await applyScheduleEdit({
      client: scheduler,
      projectId: PROJECT_ID,
      editSessionId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      actingUserId: schedulerId,
      ops: [
        { type: "createActivity", tempId: "ta", wbsNodeId: WBS_ID,
          name: "CycleA", activityType: "task", originalDuration: 1 },
        { type: "createActivity", tempId: "tb", wbsNodeId: WBS_ID,
          name: "CycleB", activityType: "task", originalDuration: 1 },
        { type: "addDependency", tempId: "d1",
          predecessorId: "ta", successorId: "tb", relType: "FS", lag: 0 },
        { type: "addDependency", tempId: "d2",
          predecessorId: "tb", successorId: "ta", relType: "FS", lag: 0 },
      ],
    });
    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.error).toBe("ENGINE_CYCLE");
  });

  it("is idempotent on retry with the same requestId", async () => {
    const reqId = crypto.randomUUID();
    const args = {
      client: scheduler,
      projectId: PROJECT_ID,
      editSessionId: crypto.randomUUID(),
      requestId: reqId,
      actingUserId: schedulerId,
      ops: [{
        type: "createActivity" as const, tempId: "idem1", wbsNodeId: WBS_ID,
        name: "Idempotent A", activityType: "task" as const, originalDuration: 2,
      }],
    };
    const r1 = await applyScheduleEdit(args);
    expect(r1.ok).toBe(true);
    const r2 = await applyScheduleEdit(args);
    expect(r2).toEqual(r1);

    const s = service();
    const count = await s.from("activities").select("id", { count: "exact", head: true })
      .eq("name", "Idempotent A").eq("project_id", PROJECT_ID);
    expect(count.count).toBe(1);
  });
});
