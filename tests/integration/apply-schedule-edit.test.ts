import { describe, it, expect, beforeAll } from "vitest";
import { seedFixture, asUser, service, SCHED_ID, PROJECT_ID, WBS_ID } from "./setup";

let scheduler: Awaited<ReturnType<typeof asUser>>;

beforeAll(async () => {
  await seedFixture();
  scheduler = await asUser(SCHED_ID);
});

async function post(client: Awaited<ReturnType<typeof asUser>>, body: unknown) {
  const { data: sessionData } = await client.auth.getSession();
  const token = sessionData.session?.access_token;
  return fetch("http://localhost:3000/api/schedule/apply", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}`, cookie: `sb-access-token=${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/schedule/apply (integration)", () => {
  it("creates an activity, runs the engine, persists computed dates", async () => {
    const r = await post(scheduler, {
      projectId: PROJECT_ID,
      editSessionId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      ops: [{
        type: "createActivity", tempId: "t1",
        wbsNodeId: WBS_ID, name: "Pour Slab",
        activityType: "task", originalDuration: 5,
      }],
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.data.temp_id_map.t1).toBeTruthy();

    const s = service();
    const persisted = await s.from("activities")
      .select("id, planned_start, planned_finish, version")
      .eq("id", body.data.temp_id_map.t1).single();
    expect(persisted.data?.planned_start).toBeTruthy();
    expect(persisted.data?.planned_finish).toBeTruthy();
    expect(persisted.data?.version).toBe(1);
  });

  it("returns STALE_STATE when base_versions don't match", async () => {
    const s = service();
    const acts = await s.from("activities").select("id, version")
      .eq("project_id", PROJECT_ID).limit(1);
    const target = acts.data![0];

    await s.from("activities").update({ version: target.version + 5 }).eq("id", target.id);

    const { data } = await scheduler.rpc("apply_schedule_edit", {
      p_payload: {
        project_id: PROJECT_ID,
        request_id: crypto.randomUUID(),
        acting_user_id: (await scheduler.auth.getUser()).data.user!.id,
        edit_session_id: crypto.randomUUID(),
        intent_op_count: 0,
        base_versions: {
          project_version: 1,
          activities: { [target.id]: target.version },
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
    const r = await post(scheduler, {
      projectId: PROJECT_ID,
      editSessionId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
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
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe("ENGINE_CYCLE");
  });

  it("is idempotent on retry with the same requestId", async () => {
    const reqId = crypto.randomUUID();
    const payload = {
      projectId: PROJECT_ID,
      editSessionId: crypto.randomUUID(),
      requestId: reqId,
      ops: [{
        type: "createActivity", tempId: "idem1", wbsNodeId: WBS_ID,
        name: "Idempotent A", activityType: "task", originalDuration: 2,
      }],
    };
    const r1 = await post(scheduler, payload);
    const b1 = await r1.json();
    expect(b1.ok).toBe(true);

    const r2 = await post(scheduler, payload);
    const b2 = await r2.json();
    expect(b2).toEqual(b1);

    const s = service();
    const count = await s.from("activities").select("id", { count: "exact", head: true })
      .eq("name", "Idempotent A").eq("project_id", PROJECT_ID);
    expect(count.count).toBe(1);
  });
});
