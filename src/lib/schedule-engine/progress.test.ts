import { describe, expect, it } from "vitest";
import { resolveProgress } from "./progress";
import type { ActivityInput } from "./types";

function base(overrides: Partial<ActivityInput>): ActivityInput {
  return { id: "a", type: "task", originalDuration: 5, remainingDuration: 5, ...overrides };
}

describe("resolveProgress", () => {
  it("classifies a not-started activity when dataDate is null", () => {
    const r = resolveProgress(base({}), null);
    expect(r.status).toBe("not_started");
    expect(r.remainingFloor).toBeNull();
  });
  it("classifies a not-started activity and floors remaining work at the data date", () => {
    const r = resolveProgress(base({ percentComplete: 0 }), "2026-06-10");
    expect(r.status).toBe("not_started");
    expect(r.remainingFloor).toBe("2026-06-10");
  });
  it("classifies an in-progress activity, pins the actual start, floors at data date", () => {
    const r = resolveProgress(
      base({ percentComplete: 40, actualStart: "2026-06-02", remainingDuration: 3 }),
      "2026-06-10",
    );
    expect(r.status).toBe("in_progress");
    expect(r.pinnedStart).toBe("2026-06-02");
    expect(r.remainingFloor).toBe("2026-06-10");
    expect(r.remainingDuration).toBe(3);
  });
  it("classifies a complete activity and pins both actual dates", () => {
    const r = resolveProgress(
      base({ percentComplete: 100, actualStart: "2026-06-02", actualFinish: "2026-06-06" }),
      "2026-06-10",
    );
    expect(r.status).toBe("complete");
    expect(r.pinnedStart).toBe("2026-06-02");
    expect(r.pinnedFinish).toBe("2026-06-06");
  });
});
