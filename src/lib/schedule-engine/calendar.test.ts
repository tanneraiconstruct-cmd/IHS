import { describe, expect, it } from "vitest";
import {
  isWorkingDay,
  nextWorkingDay,
  previousWorkingDay,
  addWorkingTime,
  subtractWorkingTime,
  workingTimeBetween,
  resolveCalendar,
} from "./calendar";
import type { Calendar } from "./types";

// Mon-Fri working week. 2026-06-01 is a Monday.
const week: Calendar = { id: "w", workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] };
// Same, but 2026-06-03 (Wed) is a holiday.
const withHoliday: Calendar = {
  id: "h",
  workingWeekdays: [1, 2, 3, 4, 5],
  exceptions: [{ date: "2026-06-03", working: false }],
};

describe("isWorkingDay", () => {
  it("treats configured weekdays as working", () => {
    expect(isWorkingDay("2026-06-01", week)).toBe(true); // Monday
  });
  it("treats weekends as non-working", () => {
    expect(isWorkingDay("2026-06-06", week)).toBe(false); // Saturday
  });
  it("honors a non-working exception", () => {
    expect(isWorkingDay("2026-06-03", withHoliday)).toBe(false);
  });
  it("honors a working exception on a weekend", () => {
    const sat: Calendar = {
      id: "s", workingWeekdays: [1, 2, 3, 4, 5],
      exceptions: [{ date: "2026-06-06", working: true }],
    };
    expect(isWorkingDay("2026-06-06", sat)).toBe(true);
  });
});

describe("nextWorkingDay / previousWorkingDay", () => {
  it("returns the date itself when already working", () => {
    expect(nextWorkingDay("2026-06-01", week)).toBe("2026-06-01");
  });
  it("advances over a weekend", () => {
    expect(nextWorkingDay("2026-06-06", week)).toBe("2026-06-08"); // Sat -> Mon
  });
  it("steps back over a weekend", () => {
    expect(previousWorkingDay("2026-06-07", week)).toBe("2026-06-05"); // Sun -> Fri
  });
});

describe("addWorkingTime", () => {
  it("returns the date unchanged for zero units", () => {
    expect(addWorkingTime("2026-06-01", 0, week)).toBe("2026-06-01");
  });
  it("advances one working day", () => {
    expect(addWorkingTime("2026-06-01", 1, week)).toBe("2026-06-02");
  });
  it("skips the weekend", () => {
    // Mon + 5 working days -> next Mon
    expect(addWorkingTime("2026-06-01", 5, week)).toBe("2026-06-08");
  });
  it("skips a holiday", () => {
    // Mon + 3 working days, Wed is a holiday -> Mon,Tue,Thu => Fri
    expect(addWorkingTime("2026-06-01", 3, withHoliday)).toBe("2026-06-05");
  });
  it("treats a negative count as a subtraction", () => {
    expect(addWorkingTime("2026-06-08", -5, week)).toBe("2026-06-01");
  });
});

describe("subtractWorkingTime", () => {
  it("steps back skipping the weekend", () => {
    expect(subtractWorkingTime("2026-06-08", 5, week)).toBe("2026-06-01");
  });
});

describe("workingTimeBetween", () => {
  it("is zero for equal dates", () => {
    expect(workingTimeBetween("2026-06-01", "2026-06-01", week)).toBe(0);
  });
  it("counts working days, weekend excluded", () => {
    expect(workingTimeBetween("2026-06-01", "2026-06-08", week)).toBe(5);
  });
  it("round-trips with addWorkingTime", () => {
    const end = addWorkingTime("2026-06-01", 7, week);
    expect(workingTimeBetween("2026-06-01", end, week)).toBe(7);
  });
});

describe("resolveCalendar", () => {
  it("returns the override calendar when the activity sets calendarId", () => {
    const cal = resolveCalendar(
      { id: "a", type: "task", originalDuration: 1, remainingDuration: 1, calendarId: "h" },
      [week, withHoliday],
      "w",
    );
    expect(cal.id).toBe("h");
  });
  it("falls back to the default calendar id", () => {
    const cal = resolveCalendar(
      { id: "a", type: "task", originalDuration: 1, remainingDuration: 1 },
      [week, withHoliday],
      "w",
    );
    expect(cal.id).toBe("w");
  });
});
