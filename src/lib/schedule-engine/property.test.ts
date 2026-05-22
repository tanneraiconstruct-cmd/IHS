import { describe, expect, it } from "vitest";
import { calculate } from "./index";
import { workingTimeBetween } from "./calendar";
import type { ActivityInput, DependencyInput, ScheduleInput } from "./types";

const week = { id: "w", workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] };

/** Deterministic PRNG (mulberry32) so failures reproduce exactly. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a random acyclic schedule. Activities are numbered 0..n-1; every
 * dependency runs from a lower-numbered predecessor to a higher-numbered
 * successor, which guarantees the graph is a DAG.
 */
function randomSchedule(seed: number): ScheduleInput {
  const next = rng(seed);
  const count = 3 + Math.floor(next() * 8); // 3-10 activities
  const activities: ActivityInput[] = [];
  for (let i = 0; i < count; i += 1) {
    activities.push({
      id: `a${i}`,
      type: next() < 0.15 ? "milestone" : "task",
      originalDuration: 1 + Math.floor(next() * 9),
      remainingDuration: 1 + Math.floor(next() * 9),
    });
  }
  const depTypes = ["FS", "SS", "FF", "SF"] as const;
  const dependencies: DependencyInput[] = [];
  let depId = 0;
  for (let s = 1; s < count; s += 1) {
    for (let p = 0; p < s; p += 1) {
      if (next() < 0.35) {
        dependencies.push({
          id: `d${depId++}`,
          predecessorId: `a${p}`,
          successorId: `a${s}`,
          type: depTypes[Math.floor(next() * 4)],
          lag: 0,
          isActive: true,
        });
      }
    }
  }
  return {
    projectStart: "2026-06-01",
    dataDate: null,
    defaultCalendarId: "w",
    calendars: [week],
    activities,
    dependencies,
  };
}

describe("engine invariants over randomized DAGs", () => {
  it("holds for 200 random schedules", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const input = randomSchedule(seed);
      const result = calculate(input);

      // No cycle was generated, so the schedule must be solvable.
      expect(result.projectFinish, `seed ${seed} should be solvable`).not.toBeNull();

      let maxEarlyFinish = "0000-00-00";
      let sawCritical = false;
      for (const a of result.activities) {
        // Finish is never before start.
        expect(a.earlyStart <= a.earlyFinish, `seed ${seed} ${a.id} EF>=ES`).toBe(true);
        expect(a.lateStart <= a.lateFinish, `seed ${seed} ${a.id} LF>=LS`).toBe(true);
        // Total float is the working-time gap between ES and LS.
        const expectedFloat =
          a.earlyStart <= a.lateStart
            ? workingTimeBetween(a.earlyStart, a.lateStart, week)
            : -workingTimeBetween(a.lateStart, a.earlyStart, week);
        expect(a.totalFloat, `seed ${seed} ${a.id} totalFloat`).toBe(expectedFloat);
        // Free float can never exceed total float — a universal CPM invariant.
        expect(a.freeFloat <= a.totalFloat, `seed ${seed} ${a.id} freeFloat <= totalFloat`).toBe(true);
        if (a.earlyFinish > maxEarlyFinish) maxEarlyFinish = a.earlyFinish;
        if (a.isCritical) sawCritical = true;
      }
      // Project finish is the latest early finish.
      expect(result.projectFinish, `seed ${seed} projectFinish = max EF`).toBe(maxEarlyFinish);
      // A solvable, non-empty schedule always has at least one critical activity.
      if (result.activities.length > 0) {
        expect(sawCritical, `seed ${seed} has a critical activity`).toBe(true);
      }
    }
  });

  it("is deterministic across repeated calls", () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const input = randomSchedule(seed);
      expect(calculate(input)).toEqual(calculate(input));
    }
  });
});
