import { describe, expect, it } from "vitest";
import { calculate } from "../index";
import type { ScheduleInput } from "../types";

// Mon-Fri week. 2026-06-01 is a Monday.
const week = { id: "w", workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] };

describe("golden master: three-task FS chain", () => {
  // a(5d) -> b(3d) -> c(2d), all FS lag 0, no constraints.
  const input: ScheduleInput = {
    projectStart: "2026-06-01",
    dataDate: null,
    defaultCalendarId: "w",
    calendars: [week],
    activities: [
      { id: "a", type: "task", originalDuration: 5, remainingDuration: 5 },
      { id: "b", type: "task", originalDuration: 3, remainingDuration: 3 },
      { id: "c", type: "task", originalDuration: 2, remainingDuration: 2 },
    ],
    dependencies: [
      { id: "d1", predecessorId: "a", successorId: "b", type: "FS", lag: 0, isActive: true },
      { id: "d2", predecessorId: "b", successorId: "c", type: "FS", lag: 0, isActive: true },
    ],
  };

  it("computes exact dates and a fully critical chain", () => {
    const r = calculate(input);
    const byId = new Map(r.activities.map((x) => [x.id, x]));
    expect(byId.get("a")).toMatchObject({
      earlyStart: "2026-06-01", earlyFinish: "2026-06-08",
      lateStart: "2026-06-01", lateFinish: "2026-06-08",
      totalFloat: 0, freeFloat: 0, isCritical: true,
    });
    expect(byId.get("b")).toMatchObject({
      earlyStart: "2026-06-08", earlyFinish: "2026-06-11",
      totalFloat: 0, isCritical: true,
    });
    expect(byId.get("c")).toMatchObject({
      earlyStart: "2026-06-11", earlyFinish: "2026-06-15",
      totalFloat: 0, isCritical: true,
    });
    expect(r.projectFinish).toBe("2026-06-15");
  });
});

describe("golden master: parallel paths with float", () => {
  // start -> {a(2d), b(6d)} -> end. a is parallel to b and carries float.
  const input: ScheduleInput = {
    projectStart: "2026-06-01",
    dataDate: null,
    defaultCalendarId: "w",
    calendars: [week],
    activities: [
      { id: "start", type: "milestone", originalDuration: 0, remainingDuration: 0 },
      { id: "a", type: "task", originalDuration: 2, remainingDuration: 2 },
      { id: "b", type: "task", originalDuration: 6, remainingDuration: 6 },
      { id: "end", type: "milestone", originalDuration: 0, remainingDuration: 0 },
    ],
    dependencies: [
      { id: "d1", predecessorId: "start", successorId: "a", type: "FS", lag: 0, isActive: true },
      { id: "d2", predecessorId: "start", successorId: "b", type: "FS", lag: 0, isActive: true },
      { id: "d3", predecessorId: "a", successorId: "end", type: "FS", lag: 0, isActive: true },
      { id: "d4", predecessorId: "b", successorId: "end", type: "FS", lag: 0, isActive: true },
    ],
  };

  it("gives the short parallel branch positive float and keeps the long branch critical", () => {
    const r = calculate(input);
    const byId = new Map(r.activities.map((x) => [x.id, x]));
    expect(byId.get("a")?.totalFloat).toBe(4); // 6 - 2 working days
    expect(byId.get("a")?.isCritical).toBe(false);
    expect(byId.get("b")?.totalFloat).toBe(0);
    expect(byId.get("b")?.isCritical).toBe(true);
    expect(r.projectFinish).toBe("2026-06-09"); // start Mon + 6 working days
  });
});

describe("golden master: SS relationship with lag", () => {
  // a(5d), b(4d) with SS lag 2: b starts 2 working days after a starts.
  const input: ScheduleInput = {
    projectStart: "2026-06-01",
    dataDate: null,
    defaultCalendarId: "w",
    calendars: [week],
    activities: [
      { id: "a", type: "task", originalDuration: 5, remainingDuration: 5 },
      { id: "b", type: "task", originalDuration: 4, remainingDuration: 4 },
    ],
    dependencies: [
      { id: "d1", predecessorId: "a", successorId: "b", type: "SS", lag: 2, isActive: true },
    ],
  };

  it("starts the successor a lag offset after the predecessor start", () => {
    const r = calculate(input);
    const byId = new Map(r.activities.map((x) => [x.id, x]));
    expect(byId.get("b")?.earlyStart).toBe("2026-06-03");
    expect(byId.get("b")?.earlyFinish).toBe("2026-06-09");
  });
});

describe("golden master: holiday calendar shifts dates", () => {
  // 2026-06-03 (Wed) is a holiday; a 4-day task starting Mon finishes later.
  const withHoliday = {
    id: "w",
    workingWeekdays: [1, 2, 3, 4, 5],
    exceptions: [{ date: "2026-06-03", working: false }],
  };
  const input: ScheduleInput = {
    projectStart: "2026-06-01",
    dataDate: null,
    defaultCalendarId: "w",
    calendars: [withHoliday],
    activities: [{ id: "a", type: "task", originalDuration: 4, remainingDuration: 4 }],
    dependencies: [],
  };

  it("skips the holiday when computing the early finish", () => {
    const r = calculate(input);
    // Mon,Tue,(skip Wed),Thu,Fri worked => EF is the following Mon
    expect(r.activities[0].earlyFinish).toBe("2026-06-08");
  });
});
