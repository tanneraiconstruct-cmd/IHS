import { describe, it, expect } from "vitest";
import { validateOps } from "./validate";

describe("validateOps", () => {
  it("accepts a valid createActivity op", () => {
    const result = validateOps([
      {
        type: "createActivity",
        tempId: "t1",
        wbsNodeId: "11111111-1111-1111-1111-111111111111",
        name: "Pour Slab",
        activityType: "task",
        originalDuration: 5,
      },
    ]);
    expect(result.ok).toBe(true);
  });

  it("rejects an op with a negative duration", () => {
    const result = validateOps([
      {
        type: "createActivity",
        tempId: "t1",
        wbsNodeId: "11111111-1111-1111-1111-111111111111",
        name: "Pour Slab",
        activityType: "task",
        originalDuration: -1,
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].path).toContain("originalDuration");
    }
  });

  it("rejects an unknown op type", () => {
    const result = validateOps([{ type: "movePaneA", id: "x" } as never]);
    expect(result.ok).toBe(false);
  });

  it("rejects addDependency with predecessor === successor", () => {
    const result = validateOps([
      {
        type: "addDependency",
        tempId: "t1",
        predecessorId: "22222222-2222-2222-2222-222222222222",
        successorId: "22222222-2222-2222-2222-222222222222",
        relType: "FS",
        lag: 0,
      },
    ]);
    expect(result.ok).toBe(false);
  });

  it("rejects setConstraint without a date for date-bearing types", () => {
    const result = validateOps([
      { type: "setConstraint", activityId: "a1", constraintType: "SNET" },
    ]);
    expect(result.ok).toBe(false);
  });

  it("accepts setConstraint type=ALAP without a date", () => {
    const result = validateOps([
      { type: "setConstraint", activityId: "33333333-3333-3333-3333-333333333333",
        constraintType: "ALAP" },
    ]);
    expect(result.ok).toBe(true);
  });
});
