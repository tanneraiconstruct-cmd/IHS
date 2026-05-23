import { describe, it, expect } from "vitest";
import { buildPayload } from "./build-payload";
import type { IntentOp } from "../shared/types";

describe("buildPayload", () => {
  it("emits intent + cascade history rows for a duration change", () => {
    const result = buildPayload({
      projectId: "p1",
      editSessionId: "es1",
      actingUserId: "u1",
      requestId: "r1",
      ops: [{
        type: "setActivityFields", activityId: "a1",
        patch: { originalDuration: 7 },
      }] satisfies IntentOp[],
      tempIdMap: {},
      preEngineActivities: [
        { id: "a1", original_duration: 5, planned_start: "2026-06-01",
          planned_finish: "2026-06-05" },
        { id: "a2", original_duration: 3, planned_start: "2026-06-08",
          planned_finish: "2026-06-10" },
      ],
      postEngineActivities: [
        { id: "a1", earlyStart: "2026-06-01", earlyFinish: "2026-06-09",
          lateStart: "2026-06-01", lateFinish: "2026-06-09",
          plannedStart: "2026-06-01", plannedFinish: "2026-06-09",
          totalFloat: 0, freeFloat: 0, isCritical: true },
        { id: "a2", earlyStart: "2026-06-10", earlyFinish: "2026-06-12",
          lateStart: "2026-06-10", lateFinish: "2026-06-12",
          plannedStart: "2026-06-10", plannedFinish: "2026-06-12",
          totalFloat: 0, freeFloat: 0, isCritical: true },
      ],
      preEngineConstraints: [],
      preEngineDependencies: [],
      baseVersions: {
        project_version: 1, activities: { a1: 1, a2: 1 },
        dependencies: {}, constraints: {},
      },
      softDeleted: { activityIds: [], dependencyIds: [] },
      projectPatch: {},
      engineProblems: [],
      originalActivityInputs: {
        a1: { name: "A1", wbs_node_id: "w1", activity_type: "task" },
        a2: { name: "A2", wbs_node_id: "w1", activity_type: "task" },
      },
    });

    expect(result.intentOpCount).toBe(1);
    const intent = result.payload.history_rows.filter(r => r.source === "intent");
    const cascade = result.payload.history_rows.filter(r => r.source === "engine_cascade");
    expect(intent).toHaveLength(1);
    expect(intent[0].field).toBe("original_duration");
    // a1 planned_finish changed AND a2 planned_start/finish changed
    expect(cascade.length).toBeGreaterThanOrEqual(3);
    expect(cascade.every(r => r.op_index === null)).toBe(true);
  });
});
