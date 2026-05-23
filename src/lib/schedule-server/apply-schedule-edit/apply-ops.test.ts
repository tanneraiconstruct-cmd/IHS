import { describe, it, expect } from "vitest";
import { applyOps } from "./apply-ops";
import type { IntentOp } from "../shared/types";
import type { ScheduleInput } from "@/lib/schedule-engine/types";

const baseInput: ScheduleInput = {
  projectStart: "2026-06-01",
  dataDate: null,
  defaultCalendarId: "cal1",
  calendars: [{ id: "cal1", workingWeekdays: [1,2,3,4,5], exceptions: [] }],
  activities: [
    { id: "a1", type: "task", originalDuration: 5, remainingDuration: 5 },
    { id: "a2", type: "task", originalDuration: 3, remainingDuration: 3 },
  ],
  dependencies: [],
};

describe("applyOps", () => {
  it("createActivity adds an activity with a uuid mapped from tempId", () => {
    const ops: IntentOp[] = [{
      type: "createActivity", tempId: "t1",
      wbsNodeId: "11111111-1111-1111-1111-111111111111",
      name: "New", activityType: "task", originalDuration: 7,
    }];
    const r = applyOps(baseInput, ops);
    expect(r.input.activities).toHaveLength(3);
    expect(r.tempIdMap).toHaveProperty("t1");
    expect(r.input.activities.find(a => a.id === r.tempIdMap.t1)).toBeTruthy();
  });

  it("setActivityFields patches only listed fields", () => {
    const r = applyOps(baseInput, [{
      type: "setActivityFields", activityId: "a1",
      patch: { originalDuration: 9 },
    }]);
    const a1 = r.input.activities.find(a => a.id === "a1")!;
    expect(a1.originalDuration).toBe(9);
    expect(a1.remainingDuration).toBe(5);
  });

  it("addDependency adds a link, deactivateDependency flips is_active", () => {
    const r1 = applyOps(baseInput, [{
      type: "addDependency", tempId: "d1",
      predecessorId: "a1", successorId: "a2", relType: "FS", lag: 0,
    }]);
    expect(r1.input.dependencies).toHaveLength(1);
    const depId = r1.tempIdMap.d1;
    const r2 = applyOps(r1.input, [
      { type: "deactivateDependency", dependencyId: depId },
    ]);
    expect(r2.input.dependencies[0].isActive).toBe(false);
  });

  it("setConstraint upserts an at-most-one constraint per activity", () => {
    const r = applyOps(baseInput, [{
      type: "setConstraint", activityId: "a1",
      constraintType: "SNET", date: "2026-07-01",
    }]);
    expect(r.input.activities.find(a => a.id === "a1")!.constraint)
      .toEqual({ type: "SNET", date: "2026-07-01" });
  });

  it("addDependency resolves sibling tempIds from earlier createActivity ops", () => {
    const r = applyOps(baseInput, [
      { type: "createActivity", tempId: "ta",
        wbsNodeId: "11111111-1111-1111-1111-111111111111",
        name: "A new", activityType: "task", originalDuration: 4 },
      { type: "createActivity", tempId: "tb",
        wbsNodeId: "11111111-1111-1111-1111-111111111111",
        name: "B new", activityType: "task", originalDuration: 2 },
      { type: "addDependency", tempId: "d1",
        predecessorId: "ta", successorId: "tb", relType: "FS", lag: 0 },
    ]);
    expect(r.input.dependencies).toHaveLength(1);
    const dep = r.input.dependencies[0];
    expect(dep.predecessorId).toBe(r.tempIdMap.ta);
    expect(dep.successorId).toBe(r.tempIdMap.tb);
  });

  it("softDeleteActivity removes the activity AND any deps referencing it", () => {
    const withDep = applyOps(baseInput, [{
      type: "addDependency", tempId: "d1",
      predecessorId: "a1", successorId: "a2", relType: "FS", lag: 0,
    }]);
    const r = applyOps(withDep.input, [{ type: "softDeleteActivity", activityId: "a1" }]);
    expect(r.input.activities.find(a => a.id === "a1")).toBeUndefined();
    expect(r.input.dependencies).toHaveLength(0);
  });
});
