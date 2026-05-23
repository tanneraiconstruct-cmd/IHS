import { describe, it, expect } from "vitest";
import { wouldCreateCycle } from "./wbs-cycle";

describe("wouldCreateCycle", () => {
  it("detects a direct self-cycle", () => {
    expect(wouldCreateCycle([{ id: "a", parent_id: null }], "a", "a")).toBe(true);
  });
  it("detects an indirect cycle (b under a, reparent a under b)", () => {
    expect(wouldCreateCycle(
      [{ id: "a", parent_id: null }, { id: "b", parent_id: "a" }],
      "a", "b",
    )).toBe(true);
  });
  it("returns false for a valid reparent", () => {
    expect(wouldCreateCycle(
      [{ id: "a", parent_id: null }, { id: "b", parent_id: null }],
      "b", "a",
    )).toBe(false);
  });
});
