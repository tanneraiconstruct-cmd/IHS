import { describe, it, expect } from "vitest";
import {
  DAY_W, ROW_H,
  dayToX, isoDiffDays, isoAddDays, barRect, dependencyPath,
} from "./layout";

describe("layout primitives", () => {
  it("isoDiffDays counts whole days between two YYYY-MM-DD strings", () => {
    expect(isoDiffDays("2026-05-04", "2026-05-04")).toBe(0);
    expect(isoDiffDays("2026-05-04", "2026-05-05")).toBe(1);
    expect(isoDiffDays("2026-05-04", "2026-05-11")).toBe(7);
  });

  it("isoAddDays returns the next iso date n days later", () => {
    expect(isoAddDays("2026-05-04", 7)).toBe("2026-05-11");
    expect(isoAddDays("2026-05-04", -1)).toBe("2026-05-03");
  });

  it("dayToX maps an iso date to a pixel offset from the project start", () => {
    expect(dayToX("2026-05-04", "2026-05-04")).toBe(0);
    expect(dayToX("2026-05-04", "2026-05-11")).toBe(7 * DAY_W);
  });

  it("barRect produces the right left/width for a multi-day activity", () => {
    const rect = barRect({
      projectStart: "2026-05-04",
      plannedStart: "2026-05-04",
      plannedFinish: "2026-05-08",
      rowIndex: 2,
    });
    expect(rect.left).toBe(0);
    expect(rect.width).toBe(5 * DAY_W);
    expect(rect.top).toBe(2 * ROW_H);
  });

  it("dependencyPath produces a polyline from predecessor end to successor start", () => {
    const path = dependencyPath(
      { left: 0, top: 0, width: DAY_W * 3 },
      { left: DAY_W * 4, top: ROW_H, width: DAY_W * 2 },
    );
    expect(path).toContain("M");
    expect(path).toContain("L");
  });
});
