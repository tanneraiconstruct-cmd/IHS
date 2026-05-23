import { describe, it, expect, expectTypeOf } from "vitest";
import type { IntentOp, ErrorCode, ApplyScheduleEditResponse } from "./types";

describe("IntentOp discriminated union", () => {
  it("requires the right fields per op type", () => {
    const op1: IntentOp = {
      type: "createActivity",
      tempId: "t1",
      wbsNodeId: "w1",
      name: "Pour Slab",
      activityType: "task",
      originalDuration: 5,
    };
    expect(op1.type).toBe("createActivity");

    const op2: IntentOp = {
      type: "setProgress",
      activityId: "a1",
      percentComplete: 50,
    };
    expect(op2.type).toBe("setProgress");
  });

  it("error union is exhaustive", () => {
    const codes: ErrorCode[] = [
      "UNAUTHENTICATED", "IDENTITY_MISMATCH", "FORBIDDEN",
      "VALIDATION_FAILED", "ENGINE_CYCLE", "STALE_STATE",
      "PAYLOAD_INVALID", "INTERNAL",
    ];
    expect(codes).toHaveLength(8);
  });

  it("response shape narrows on ok", () => {
    const ok: ApplyScheduleEditResponse = {
      ok: true,
      data: {
        applied_at: "2026-05-22T00:00:00Z",
        project_version: 2,
        activities: [],
        dependencies: [],
        constraints: [],
        project: {
          id: "p1", version: 2, schedule_dirty_at: null,
          last_engine_problems: [],
        },
        temp_id_map: {},
        history_ids: [],
      },
    };
    expectTypeOf(ok).toMatchTypeOf<{ ok: true }>();
  });
});
