import { describe, it, expect, beforeAll } from "vitest";
import { seedFixture, asUser, service, SCHED_ID, PROJECT_ID, WBS_ID } from "./setup";

let scheduler: Awaited<ReturnType<typeof asUser>>;

beforeAll(async () => {
  await seedFixture();
  scheduler = await asUser(SCHED_ID);
});

async function authed(path: string) {
  const { data: sessionData } = await scheduler.auth.getSession();
  const token = sessionData.session?.access_token;
  return fetch(`http://localhost:3000${path}`, {
    headers: token
      ? { authorization: `Bearer ${token}`, cookie: `sb-access-token=${token}` }
      : {},
  });
}

describe("GET /api/projects/:id/schedule", () => {
  it("returns the full hydrated schedule with engine-computed dates", async () => {
    const { data: sessionData } = await scheduler.auth.getSession();
    const token = sessionData.session?.access_token;
    await fetch("http://localhost:3000/api/schedule/apply", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        cookie: `sb-access-token=${token}`,
      },
      body: JSON.stringify({
        projectId: PROJECT_ID,
        editSessionId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        ops: [{
          type: "createActivity", tempId: "g1", wbsNodeId: WBS_ID,
          name: "Hydration check", activityType: "task", originalDuration: 3,
        }],
      }),
    });

    const r = await authed(`/api/projects/${PROJECT_ID}/schedule`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.data.project.id).toBe(PROJECT_ID);
    expect(body.data.activities.length).toBeGreaterThanOrEqual(1);

    const created = body.data.activities.find(
      (a: { name: string; planned_start: string | null }) =>
        a.name === "Hydration check" && a.planned_start !== null);
    expect(created).toBeTruthy();
  });

  it("returns stale=true when projects.schedule_dirty_at is set", async () => {
    const s = service();
    await s.from("projects")
      .update({ schedule_dirty_at: new Date().toISOString() })
      .eq("id", PROJECT_ID);

    const r = await authed(`/api/projects/${PROJECT_ID}/schedule`);
    const body = await r.json();
    expect(body.data.stale).toBe(true);

    await s.from("projects").update({ schedule_dirty_at: null }).eq("id", PROJECT_ID);
  });
});
