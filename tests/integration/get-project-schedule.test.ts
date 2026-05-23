// Integration test: exercise getProjectSchedule directly with an authed client.

import { describe, it, expect, beforeAll } from "vitest";
import { getProjectSchedule } from "@/lib/schedule-server/get-project-schedule";
import { applyScheduleEdit } from "@/lib/schedule-server/apply-schedule-edit";
import { seedFixture, asUser, service, SCHED_ID, PROJECT_ID, WBS_ID } from "./setup";

let scheduler: Awaited<ReturnType<typeof asUser>>;
let schedulerId: string;

beforeAll(async () => {
  await seedFixture();
  scheduler = await asUser(SCHED_ID);
  schedulerId = (await scheduler.auth.getUser()).data.user!.id;
});

describe("getProjectSchedule (integration)", () => {
  it("returns the full hydrated schedule with engine-computed dates", async () => {
    await applyScheduleEdit({
      client: scheduler,
      projectId: PROJECT_ID,
      editSessionId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      actingUserId: schedulerId,
      ops: [{
        type: "createActivity", tempId: "g1", wbsNodeId: WBS_ID,
        name: "Hydration check", activityType: "task", originalDuration: 3,
      }],
    });

    const result = await getProjectSchedule(scheduler, PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.project.id).toBe(PROJECT_ID);
    expect(result.data.activities.length).toBeGreaterThanOrEqual(1);

    const created = result.data.activities.find(
      (a: { name: string; planned_start: string | null }) =>
        a.name === "Hydration check" && a.planned_start !== null);
    expect(created).toBeTruthy();
  });

  it("returns stale=true when projects.schedule_dirty_at is set", async () => {
    const s = service();
    await s.from("projects")
      .update({ schedule_dirty_at: new Date().toISOString() })
      .eq("id", PROJECT_ID);

    const result = await getProjectSchedule(scheduler, PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.stale).toBe(true);

    await s.from("projects").update({ schedule_dirty_at: null }).eq("id", PROJECT_ID);
  });
});
