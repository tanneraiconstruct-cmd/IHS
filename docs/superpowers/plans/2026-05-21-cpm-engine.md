# CPM Scheduling Engine (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, deterministic `schedule-engine/` TypeScript module that computes CPM dates, float, and the critical path from a schedule, with a full test suite and no UI or database.

**Architecture:** A pipeline of pure-function stage modules under `src/lib/schedule-engine/`. `calculate(input)` runs: validate → build graph → detect cycles → topological sort → forward pass → backward pass → float → assemble. Calendar math, constraint clamps, and progress/data-date logic are helper modules the passes call. A separate `rollup.ts` does WBS tree aggregation. Nothing mutates input; the engine never throws for schedule-data problems — every issue returns in `problems[]`.

**Tech Stack:** TypeScript 5, Vitest 4 (already configured: `include: ['src/**/*.test.ts']`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-21-cpm-engine-design.md`.

---

## Conventions (read before starting)

- **Dates** cross every boundary as ISO `YYYY-MM-DD` strings. ISO strings compare chronologically with `<`/`>`, so `a < b` means `a` is earlier. `min`/`max` of dates is plain string comparison.
- **Exclusive-finish instant convention.** `ES`/`EF`/`LS`/`LF` are working-day instants. A task spans `[start, finish)`. `EF = addWorkingTime(ES, duration)`; a milestone has duration 0 so `EF = ES`. An `FS` successor with lag 0 starts exactly at the predecessor's `EF`.
- **Durations, floats, lags** are integer working days.
- **Milestone effective duration is always 0**, regardless of the `remainingDuration` field.
- **Constraints apply to not-started activities only** in v1; in-progress and complete activities are already underway and ignore constraints.
- All files are pure TypeScript — no DB, HTTP, or React imports anywhere under `schedule-engine/`.

## File Structure

```
src/lib/schedule-engine/
  types.ts          // public input/output contract (Task 1)
  calendar.ts       // working-time arithmetic (Task 2)
  graph.ts          // adjacency, cycle detection, topological sort (Task 3)
  constraints.ts    // forward/backward constraint clamps (Task 4)
  progress.ts       // data-date / actuals resolution (Task 5)
  forwardPass.ts    // ES/EF (Task 6)
  backwardPass.ts   // LS/LF (Task 7)
  float.ts          // total/free float, critical flag (Task 8)
  index.ts          // validate + calculate() orchestrator (Task 9)
  rollup.ts         // WBS summary rollup (Task 10)
  golden/
    golden.test.ts  // hand-built golden-master schedules (Task 11)
  *.test.ts         // co-located unit tests per module
  property.test.ts  // randomized-DAG invariant tests (Task 12)
```

---

### Task 1: The type contract (`types.ts`)

**Files:**
- Create: `src/lib/schedule-engine/types.ts`
- Test: `src/lib/schedule-engine/types.test.ts`

- [ ] **Step 1: Write the failing test**

A types-only file has nothing to execute, so the test imports the public surface and asserts the module resolves. This proves the file compiles and the `@/` alias works.

Create `src/lib/schedule-engine/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type {
  ScheduleInput,
  ScheduleResult,
  ActivityInput,
  DependencyInput,
  Calendar,
} from "./types";

describe("types contract", () => {
  it("a minimal ScheduleInput is assignable", () => {
    const cal: Calendar = { id: "c1", workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] };
    const act: ActivityInput = { id: "a", type: "task", originalDuration: 1, remainingDuration: 1 };
    const dep: DependencyInput = {
      id: "d", predecessorId: "a", successorId: "b", type: "FS", lag: 0, isActive: true,
    };
    const input: ScheduleInput = {
      projectStart: "2026-06-01",
      dataDate: null,
      defaultCalendarId: "c1",
      calendars: [cal],
      activities: [act],
      dependencies: [dep],
    };
    expect(input.activities).toHaveLength(1);
  });

  it("a ScheduleResult shape is assignable", () => {
    const result: ScheduleResult = { activities: [], projectFinish: null, problems: [] };
    expect(result.problems).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/schedule-engine/types.test.ts`
Expected: FAIL — `Failed to resolve import "./types"`.

- [ ] **Step 3: Write the type definitions**

Create `src/lib/schedule-engine/types.ts`:

```ts
/** ISO calendar date, 'YYYY-MM-DD'. Compares chronologically as a string. */
export type IsoDate = string;

export type ActivityType = "task" | "milestone";
export type DependencyType = "FS" | "SS" | "FF" | "SF";
export type ConstraintType =
  | "SNET" | "SNLT" | "FNET" | "FNLT" | "MSO" | "MFO" | "ALAP";

export interface CalendarException {
  /** The specific date this exception applies to. */
  date: IsoDate;
  /** true = a working day despite the weekday rule; false = a non-working day. */
  working: boolean;
}

export interface Calendar {
  id: string;
  /** Working weekdays as JS getUTCDay values: 0 = Sunday ... 6 = Saturday. */
  workingWeekdays: number[];
  exceptions: CalendarException[];
}

export interface ActivityConstraint {
  type: ConstraintType;
  /** Ignored for ALAP. */
  date: IsoDate;
}

export interface ActivityInput {
  id: string;
  type: ActivityType;
  /** Working days, >= 0. */
  originalDuration: number;
  /** Working days, >= 0. Milestones are treated as 0 regardless. */
  remainingDuration: number;
  /** Overrides the project default calendar when set. */
  calendarId?: string;
  actualStart?: IsoDate;
  actualFinish?: IsoDate;
  /** 0-100. Absent means 0. */
  percentComplete?: number;
  /** At most one constraint per activity in v1. */
  constraint?: ActivityConstraint;
}

export interface DependencyInput {
  id: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  /** Working days, may be negative (a lead). Measured on the successor's calendar. */
  lag: number;
  /** Inactive dependencies are ignored for logic. */
  isActive: boolean;
}

export interface ScheduleOptions {
  /** isCritical = totalFloat <= this. Default 0. */
  criticalFloatThreshold?: number;
}

export interface ScheduleInput {
  projectStart: IsoDate;
  /** null = the project has not started; pure forecast. */
  dataDate: IsoDate | null;
  defaultCalendarId: string;
  calendars: Calendar[];
  activities: ActivityInput[];
  dependencies: DependencyInput[];
  options?: ScheduleOptions;
}

export interface ActivityResult {
  id: string;
  earlyStart: IsoDate;
  earlyFinish: IsoDate;
  lateStart: IsoDate;
  lateFinish: IsoDate;
  /** The dates the Gantt draws. ES/EF normally; LS/LF for ALAP activities. */
  plannedStart: IsoDate;
  plannedFinish: IsoDate;
  /** Working days. May be negative. */
  totalFloat: number;
  freeFloat: number;
  isCritical: boolean;
}

export type ProblemType =
  | "invalid_input" | "cycle" | "constraint_violation" | "open_end";
export type ProblemSeverity = "error" | "warning";

export interface Problem {
  type: ProblemType;
  severity: ProblemSeverity;
  /** The activities involved (predecessor/successor ids, the looped chain, etc.). */
  activityIds: string[];
  message: string;
}

export interface ScheduleResult {
  activities: ActivityResult[];
  /** null when the schedule is unsolvable (invalid input or a cycle). */
  projectFinish: IsoDate | null;
  problems: Problem[];
}

/** WBS tree node for rollup. Not part of calculate(). */
export interface WbsNode {
  id: string;
  parentId: string | null;
  /** Activities attached directly to this node. */
  activityIds: string[];
}

export interface WbsRollup {
  nodeId: string;
  start: IsoDate | null;
  finish: IsoDate | null;
  /** Duration-weighted, 0-100. */
  percentComplete: number;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/schedule-engine/types.test.ts`
Expected: PASS — `2 passed`.

- [ ] **Step 5: Verify lint and typecheck pass**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schedule-engine/types.ts src/lib/schedule-engine/types.test.ts
git commit -m "feat: add CPM engine type contract"
```

---

### Task 2: Calendar working-time arithmetic (`calendar.ts`)

Day-based working-time math. The functions skip non-working days (weekends per `workingWeekdays`, holidays/special days per `exceptions`).

**Files:**
- Create: `src/lib/schedule-engine/calendar.ts`
- Test: `src/lib/schedule-engine/calendar.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/schedule-engine/calendar.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/schedule-engine/calendar.test.ts`
Expected: FAIL — `Failed to resolve import "./calendar"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/schedule-engine/calendar.ts`:

```ts
import type { ActivityInput, Calendar, IsoDate } from "./types";

/** Parse 'YYYY-MM-DD' as a UTC instant — avoids local-timezone drift. */
function parseIso(date: IsoDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function toIso(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

/** Shift a date by n whole calendar days (n may be negative). */
function shiftDays(date: IsoDate, n: number): IsoDate {
  const d = parseIso(date);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

export function isWorkingDay(date: IsoDate, calendar: Calendar): boolean {
  const exception = calendar.exceptions.find((e) => e.date === date);
  if (exception) return exception.working;
  return calendar.workingWeekdays.includes(parseIso(date).getUTCDay());
}

/** The given date if it is a working day, else the next working day after it. */
export function nextWorkingDay(date: IsoDate, calendar: Calendar): IsoDate {
  let d = date;
  while (!isWorkingDay(d, calendar)) d = shiftDays(d, 1);
  return d;
}

/** The given date if it is a working day, else the previous working day before it. */
export function previousWorkingDay(date: IsoDate, calendar: Calendar): IsoDate {
  let d = date;
  while (!isWorkingDay(d, calendar)) d = shiftDays(d, -1);
  return d;
}

/** The date `units` working days after `date`. Negative units subtract. */
export function addWorkingTime(date: IsoDate, units: number, calendar: Calendar): IsoDate {
  if (units < 0) return subtractWorkingTime(date, -units, calendar);
  let d = date;
  let remaining = units;
  while (remaining > 0) {
    d = shiftDays(d, 1);
    if (isWorkingDay(d, calendar)) remaining -= 1;
  }
  return d;
}

/** The date `units` working days before `date`. Negative units add. */
export function subtractWorkingTime(date: IsoDate, units: number, calendar: Calendar): IsoDate {
  if (units < 0) return addWorkingTime(date, -units, calendar);
  let d = date;
  let remaining = units;
  while (remaining > 0) {
    d = shiftDays(d, -1);
    if (isWorkingDay(d, calendar)) remaining -= 1;
  }
  return d;
}

/** Working days from `start` to `finish` (assumes finish >= start). */
export function workingTimeBetween(start: IsoDate, finish: IsoDate, calendar: Calendar): number {
  let count = 0;
  let d = start;
  while (d < finish) {
    d = shiftDays(d, 1);
    if (isWorkingDay(d, calendar)) count += 1;
  }
  return count;
}

/** The activity's override calendar, or the project default. Assumes validation passed. */
export function resolveCalendar(
  activity: ActivityInput,
  calendars: Calendar[],
  defaultCalendarId: string,
): Calendar {
  const id = activity.calendarId ?? defaultCalendarId;
  const found = calendars.find((c) => c.id === id);
  if (!found) throw new Error(`calendar not found: ${id}`);
  return found;
}
```

Note: `nextWorkingDay`/`addWorkingTime` would loop forever on a calendar with no possible working day. Task 9's validation rejects any calendar with an empty `workingWeekdays`, so callers in the engine are safe.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/schedule-engine/calendar.test.ts`
Expected: PASS — all calendar tests green.

- [ ] **Step 5: Verify lint and typecheck pass**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schedule-engine/calendar.ts src/lib/schedule-engine/calendar.test.ts
git commit -m "feat: add calendar working-time arithmetic"
```

---

### Task 3: Activity graph — adjacency, cycles, topological sort (`graph.ts`)

**Files:**
- Create: `src/lib/schedule-engine/graph.ts`
- Test: `src/lib/schedule-engine/graph.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/schedule-engine/graph.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildGraph, detectCycles, topologicalSort } from "./graph";
import type { ActivityInput, DependencyInput } from "./types";

function act(id: string): ActivityInput {
  return { id, type: "task", originalDuration: 1, remainingDuration: 1 };
}
function dep(
  id: string, predecessorId: string, successorId: string, isActive = true,
): DependencyInput {
  return { id, predecessorId, successorId, type: "FS", lag: 0, isActive };
}

describe("buildGraph", () => {
  it("indexes successors and predecessors from active dependencies", () => {
    const g = buildGraph([act("a"), act("b")], [dep("d1", "a", "b")]);
    expect(g.successors.get("a")?.map((d) => d.successorId)).toEqual(["b"]);
    expect(g.predecessors.get("b")?.map((d) => d.predecessorId)).toEqual(["a"]);
  });
  it("ignores inactive dependencies", () => {
    const g = buildGraph([act("a"), act("b")], [dep("d1", "a", "b", false)]);
    expect(g.successors.get("a") ?? []).toEqual([]);
    expect(g.predecessors.get("b") ?? []).toEqual([]);
  });
});

describe("detectCycles", () => {
  it("returns no cycles for a DAG", () => {
    const g = buildGraph([act("a"), act("b"), act("c")], [dep("d1", "a", "b"), dep("d2", "b", "c")]);
    expect(detectCycles([act("a"), act("b"), act("c")], g)).toEqual([]);
  });
  it("detects a two-node loop", () => {
    const acts = [act("a"), act("b")];
    const g = buildGraph(acts, [dep("d1", "a", "b"), dep("d2", "b", "a")]);
    const cycles = detectCycles(acts, g);
    expect(cycles.length).toBeGreaterThan(0);
    expect([...cycles[0]].sort()).toEqual(["a", "b"]);
  });
  it("detects a self-loop", () => {
    const acts = [act("a")];
    const g = buildGraph(acts, [dep("d1", "a", "a")]);
    expect(detectCycles(acts, g).length).toBeGreaterThan(0);
  });
});

describe("topologicalSort", () => {
  it("orders predecessors before successors", () => {
    const acts = [act("c"), act("a"), act("b")];
    const g = buildGraph(acts, [dep("d1", "a", "b"), dep("d2", "b", "c")]);
    const order = topologicalSort(acts, g);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
  });
  it("includes every activity exactly once", () => {
    const acts = [act("a"), act("b"), act("c")];
    const g = buildGraph(acts, [dep("d1", "a", "c")]);
    expect([...topologicalSort(acts, g)].sort()).toEqual(["a", "b", "c"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/schedule-engine/graph.test.ts`
Expected: FAIL — `Failed to resolve import "./graph"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/schedule-engine/graph.ts`:

```ts
import type { ActivityInput, DependencyInput } from "./types";

export interface ScheduleGraph {
  /** activityId -> incoming active dependencies. */
  predecessors: Map<string, DependencyInput[]>;
  /** activityId -> outgoing active dependencies. */
  successors: Map<string, DependencyInput[]>;
}

export function buildGraph(
  activities: ActivityInput[],
  dependencies: DependencyInput[],
): ScheduleGraph {
  const predecessors = new Map<string, DependencyInput[]>();
  const successors = new Map<string, DependencyInput[]>();
  for (const a of activities) {
    predecessors.set(a.id, []);
    successors.set(a.id, []);
  }
  for (const d of dependencies) {
    if (!d.isActive) continue;
    successors.get(d.predecessorId)?.push(d);
    predecessors.get(d.successorId)?.push(d);
  }
  return { predecessors, successors };
}

/**
 * Returns one ordered activity-id list per detected cycle. Empty when the
 * graph is acyclic. Uses a depth-first search; a back-edge to a node still on
 * the recursion stack reveals a loop.
 */
export function detectCycles(activities: ActivityInput[], graph: ScheduleGraph): string[][] {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const a of activities) color.set(a.id, WHITE);
  const stack: string[] = [];
  const cycles: string[][] = [];

  function visit(id: string): void {
    color.set(id, GRAY);
    stack.push(id);
    for (const d of graph.successors.get(id) ?? []) {
      const next = d.successorId;
      if (color.get(next) === GRAY) {
        const from = stack.indexOf(next);
        cycles.push(stack.slice(from));
      } else if (color.get(next) === WHITE) {
        visit(next);
      }
    }
    stack.pop();
    color.set(id, BLACK);
  }

  for (const a of activities) {
    if (color.get(a.id) === WHITE) visit(a.id);
  }
  return cycles;
}

/**
 * Activity ids ordered so every predecessor precedes its successors (Kahn's
 * algorithm). Assumes the graph is acyclic — call detectCycles first.
 */
export function topologicalSort(activities: ActivityInput[], graph: ScheduleGraph): string[] {
  const inDegree = new Map<string, number>();
  for (const a of activities) {
    inDegree.set(a.id, (graph.predecessors.get(a.id) ?? []).length);
  }
  const queue = activities.filter((a) => inDegree.get(a.id) === 0).map((a) => a.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const d of graph.successors.get(id) ?? []) {
      const next = d.successorId;
      const remaining = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  return order;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/schedule-engine/graph.test.ts`
Expected: PASS — all graph tests green.

- [ ] **Step 5: Verify lint and typecheck pass**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schedule-engine/graph.ts src/lib/schedule-engine/graph.test.ts
git commit -m "feat: add activity graph, cycle detection, topological sort"
```

---

### Task 4: Constraint clamps (`constraints.ts`)

Soft constraints. Forward clamps adjust `ES`; backward clamps adjust `LF`. A constraint that logic cannot honor (`MSO` later than logic allows, `MFO` earlier than logic allows) keeps the logic-consistent date and reports `violated: true`.

**Files:**
- Create: `src/lib/schedule-engine/constraints.ts`
- Test: `src/lib/schedule-engine/constraints.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/schedule-engine/constraints.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyForwardConstraint, applyBackwardConstraint } from "./constraints";
import type { Calendar } from "./types";

const week: Calendar = { id: "w", workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] };

describe("applyForwardConstraint", () => {
  it("returns the logic date unchanged when there is no constraint", () => {
    const r = applyForwardConstraint("2026-06-01", 3, undefined, week);
    expect(r).toEqual({ earlyStart: "2026-06-01", violated: false });
  });
  it("SNET raises ES to the constraint date", () => {
    const r = applyForwardConstraint("2026-06-01", 3, { type: "SNET", date: "2026-06-04" }, week);
    expect(r.earlyStart).toBe("2026-06-04");
  });
  it("SNET does not lower ES below the logic date", () => {
    const r = applyForwardConstraint("2026-06-10", 3, { type: "SNET", date: "2026-06-04" }, week);
    expect(r.earlyStart).toBe("2026-06-10");
  });
  it("FNET raises ES so EF is no earlier than the constraint date", () => {
    // EF >= 2026-06-12; duration 3 => ES >= subtract 3 working days = 2026-06-09
    const r = applyForwardConstraint("2026-06-01", 3, { type: "FNET", date: "2026-06-12" }, week);
    expect(r.earlyStart).toBe("2026-06-09");
  });
  it("MSO pins ES later when logic allows", () => {
    const r = applyForwardConstraint("2026-06-01", 3, { type: "MSO", date: "2026-06-05" }, week);
    expect(r).toEqual({ earlyStart: "2026-06-05", violated: false });
  });
  it("MSO is violated when logic forces a later start", () => {
    const r = applyForwardConstraint("2026-06-10", 3, { type: "MSO", date: "2026-06-05" }, week);
    expect(r).toEqual({ earlyStart: "2026-06-10", violated: true });
  });
  it("ALAP and backward-only constraints are inert in the forward pass", () => {
    const r = applyForwardConstraint("2026-06-01", 3, { type: "SNLT", date: "2026-06-04" }, week);
    expect(r).toEqual({ earlyStart: "2026-06-01", violated: false });
  });
});

describe("applyBackwardConstraint", () => {
  it("returns the logic date unchanged when there is no constraint", () => {
    const r = applyBackwardConstraint("2026-06-12", 3, undefined, week);
    expect(r).toEqual({ lateFinish: "2026-06-12", violated: false });
  });
  it("FNLT lowers LF to the constraint date", () => {
    const r = applyBackwardConstraint("2026-06-20", 3, { type: "FNLT", date: "2026-06-12" }, week);
    expect(r.lateFinish).toBe("2026-06-12");
  });
  it("SNLT lowers LF so LS is no later than the constraint date", () => {
    // LS <= 2026-06-08; duration 3 => LF <= add 3 working days = 2026-06-11
    const r = applyBackwardConstraint("2026-06-20", 3, { type: "SNLT", date: "2026-06-08" }, week);
    expect(r.lateFinish).toBe("2026-06-11");
  });
  it("MFO pins LF earlier when logic allows", () => {
    const r = applyBackwardConstraint("2026-06-20", 3, { type: "MFO", date: "2026-06-12" }, week);
    expect(r).toEqual({ lateFinish: "2026-06-12", violated: false });
  });
  it("MFO is violated when logic forces an earlier finish", () => {
    const r = applyBackwardConstraint("2026-06-05", 3, { type: "MFO", date: "2026-06-12" }, week);
    expect(r).toEqual({ lateFinish: "2026-06-05", violated: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/schedule-engine/constraints.test.ts`
Expected: FAIL — `Failed to resolve import "./constraints"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/schedule-engine/constraints.ts`:

```ts
import { addWorkingTime, subtractWorkingTime } from "./calendar";
import type { ActivityConstraint, Calendar, IsoDate } from "./types";

export interface ForwardConstraintResult {
  earlyStart: IsoDate;
  /** true when logic forces a start later than an MSO constraint allows. */
  violated: boolean;
}

export interface BackwardConstraintResult {
  lateFinish: IsoDate;
  /** true when logic forces a finish earlier than an MFO constraint allows. */
  violated: boolean;
}

const max = (a: IsoDate, b: IsoDate): IsoDate => (a > b ? a : b);
const min = (a: IsoDate, b: IsoDate): IsoDate => (a < b ? a : b);

/**
 * Clamp a logic-driven ES with a forward constraint (SNET, FNET, MSO).
 * SNLT/FNLT/MFO/ALAP are backward-only and pass through unchanged.
 */
export function applyForwardConstraint(
  logicEarlyStart: IsoDate,
  duration: number,
  constraint: ActivityConstraint | undefined,
  calendar: Calendar,
): ForwardConstraintResult {
  if (!constraint) return { earlyStart: logicEarlyStart, violated: false };
  switch (constraint.type) {
    case "SNET":
      return { earlyStart: max(logicEarlyStart, constraint.date), violated: false };
    case "FNET": {
      const esFloor = subtractWorkingTime(constraint.date, duration, calendar);
      return { earlyStart: max(logicEarlyStart, esFloor), violated: false };
    }
    case "MSO":
      return {
        earlyStart: max(logicEarlyStart, constraint.date),
        violated: logicEarlyStart > constraint.date,
      };
    default:
      return { earlyStart: logicEarlyStart, violated: false };
  }
}

/**
 * Clamp a logic-driven LF with a backward constraint (SNLT, FNLT, MFO).
 * SNET/FNET/ALAP are not backward clamps and pass through unchanged.
 */
export function applyBackwardConstraint(
  logicLateFinish: IsoDate,
  duration: number,
  constraint: ActivityConstraint | undefined,
  calendar: Calendar,
): BackwardConstraintResult {
  if (!constraint) return { lateFinish: logicLateFinish, violated: false };
  switch (constraint.type) {
    case "FNLT":
      return { lateFinish: min(logicLateFinish, constraint.date), violated: false };
    case "SNLT": {
      const lfCeiling = addWorkingTime(constraint.date, duration, calendar);
      return { lateFinish: min(logicLateFinish, lfCeiling), violated: false };
    }
    case "MFO":
      return {
        lateFinish: min(logicLateFinish, constraint.date),
        violated: logicLateFinish < constraint.date,
      };
    default:
      return { lateFinish: logicLateFinish, violated: false };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/schedule-engine/constraints.test.ts`
Expected: PASS — all constraint tests green.

- [ ] **Step 5: Verify lint and typecheck pass**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schedule-engine/constraints.ts src/lib/schedule-engine/constraints.test.ts
git commit -m "feat: add soft constraint clamps"
```

---

### Task 5: Progress & data-date resolution (`progress.ts`)

Classifies an activity as complete / in-progress / not-started and resolves how the forward pass should schedule it.

**Files:**
- Create: `src/lib/schedule-engine/progress.ts`
- Test: `src/lib/schedule-engine/progress.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/schedule-engine/progress.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/schedule-engine/progress.test.ts`
Expected: FAIL — `Failed to resolve import "./progress"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/schedule-engine/progress.ts`:

```ts
import type { ActivityInput, IsoDate } from "./types";

export type ProgressStatus = "complete" | "in_progress" | "not_started";

export interface ProgressResolution {
  status: ProgressStatus;
  /** complete & in_progress: ES is pinned to this actual start. */
  pinnedStart?: IsoDate;
  /** complete: EF is pinned to this actual finish. */
  pinnedFinish?: IsoDate;
  /**
   * in_progress & not_started: the earliest the remaining work may begin
   * (the data date). null when the project has not started.
   */
  remainingFloor: IsoDate | null;
  /** Working days of remaining work to schedule. */
  remainingDuration: number;
}

/**
 * Resolve how the forward pass should treat an activity, given the data date.
 * Complete = percentComplete 100; in-progress = strictly between 0 and 100;
 * everything else is not-started.
 */
export function resolveProgress(
  activity: ActivityInput,
  dataDate: IsoDate | null,
): ProgressResolution {
  const pct = activity.percentComplete ?? 0;
  if (pct >= 100) {
    return {
      status: "complete",
      pinnedStart: activity.actualStart,
      pinnedFinish: activity.actualFinish,
      remainingFloor: dataDate,
      remainingDuration: 0,
    };
  }
  if (pct > 0) {
    return {
      status: "in_progress",
      pinnedStart: activity.actualStart,
      remainingFloor: dataDate,
      remainingDuration: activity.remainingDuration,
    };
  }
  return {
    status: "not_started",
    remainingFloor: dataDate,
    remainingDuration: activity.remainingDuration,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/schedule-engine/progress.test.ts`
Expected: PASS — all progress tests green.

- [ ] **Step 5: Verify lint and typecheck pass**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schedule-engine/progress.ts src/lib/schedule-engine/progress.test.ts
git commit -m "feat: add progress and data-date resolution"
```

---

### Task 6: Forward pass — earliest dates (`forwardPass.ts`)

Walks activities in topological order computing `ES`/`EF`. Per activity the order is: logic-driven ES from incoming relationships → progress resolution → forward constraints → normalize to a working day → compute EF.

**Files:**
- Create: `src/lib/schedule-engine/forwardPass.ts`
- Test: `src/lib/schedule-engine/forwardPass.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/schedule-engine/forwardPass.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { forwardPass } from "./forwardPass";
import { buildGraph, topologicalSort } from "./graph";
import type { ActivityInput, DependencyInput, ScheduleInput } from "./types";

const week = { id: "w", workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] };

function makeInput(
  activities: ActivityInput[],
  dependencies: DependencyInput[],
  overrides: Partial<ScheduleInput> = {},
): ScheduleInput {
  return {
    projectStart: "2026-06-01", // Monday
    dataDate: null,
    defaultCalendarId: "w",
    calendars: [week],
    activities,
    dependencies,
    ...overrides,
  };
}

function run(input: ScheduleInput) {
  const graph = buildGraph(input.activities, input.dependencies);
  return forwardPass(input, graph, topologicalSort(input.activities, graph));
}

function task(id: string, duration: number): ActivityInput {
  return { id, type: "task", originalDuration: duration, remainingDuration: duration };
}
function fs(id: string, p: string, s: string, lag = 0): DependencyInput {
  return { id, predecessorId: p, successorId: s, type: "FS", lag, isActive: true };
}

describe("forwardPass", () => {
  it("schedules a lone activity from the project start", () => {
    const r = run(makeInput([task("a", 5)], []));
    expect(r.earlyDates.get("a")).toEqual({ es: "2026-06-01", ef: "2026-06-08" });
  });

  it("a milestone has zero duration so EF equals ES", () => {
    const r = run(makeInput([{ id: "m", type: "milestone", originalDuration: 0, remainingDuration: 0 }], []));
    expect(r.earlyDates.get("m")).toEqual({ es: "2026-06-01", ef: "2026-06-01" });
  });

  it("an FS successor starts at the predecessor's early finish", () => {
    const r = run(makeInput([task("a", 5), task("b", 3)], [fs("d", "a", "b")]));
    expect(r.earlyDates.get("b")?.es).toBe("2026-06-08");
    expect(r.earlyDates.get("b")?.ef).toBe("2026-06-11");
  });

  it("an FS successor honors positive lag", () => {
    const r = run(makeInput([task("a", 5), task("b", 3)], [fs("d", "a", "b", 2)]));
    expect(r.earlyDates.get("b")?.es).toBe("2026-06-10");
  });

  it("an SS successor starts with the predecessor plus lag", () => {
    const r = run(makeInput(
      [task("a", 5), task("b", 3)],
      [{ id: "d", predecessorId: "a", successorId: "b", type: "SS", lag: 2, isActive: true }],
    ));
    expect(r.earlyDates.get("b")?.es).toBe("2026-06-03");
  });

  it("takes the latest requirement across multiple predecessors", () => {
    const r = run(makeInput(
      [task("a", 2), task("b", 8), task("c", 1)],
      [fs("d1", "a", "c"), fs("d2", "b", "c")],
    ));
    // b finishes latest (2026-06-11); c starts then
    expect(r.earlyDates.get("c")?.es).toBe("2026-06-11");
  });

  it("ignores inactive dependencies", () => {
    const r = run(makeInput(
      [task("a", 5), task("b", 3)],
      [{ id: "d", predecessorId: "a", successorId: "b", type: "FS", lag: 0, isActive: false }],
    ));
    expect(r.earlyDates.get("b")?.es).toBe("2026-06-01");
  });

  it("reports the project finish as the latest early finish", () => {
    const r = run(makeInput([task("a", 5), task("b", 3)], [fs("d", "a", "b")]));
    expect(r.projectFinish).toBe("2026-06-11");
  });

  it("floors a not-started activity at the data date", () => {
    const r = run(makeInput([task("a", 5)], [], { dataDate: "2026-06-15" }));
    expect(r.earlyDates.get("a")?.es).toBe("2026-06-15");
  });

  it("pins a completed activity to its actual dates", () => {
    const r = run(makeInput(
      [{ id: "a", type: "task", originalDuration: 5, remainingDuration: 0,
         percentComplete: 100, actualStart: "2026-05-25", actualFinish: "2026-05-29" }],
      [], { dataDate: "2026-06-15" },
    ));
    expect(r.earlyDates.get("a")).toEqual({ es: "2026-05-25", ef: "2026-05-29" });
  });

  it("flags an MSO constraint that logic cannot honor", () => {
    const r = run(makeInput(
      [task("a", 5),
       { id: "b", type: "task", originalDuration: 3, remainingDuration: 3,
         constraint: { type: "MSO", date: "2026-06-03" } }],
      [fs("d", "a", "b")],
    ));
    expect(r.earlyDates.get("b")?.es).toBe("2026-06-08"); // logic wins
    expect(r.violations.some((p) => p.type === "constraint_violation" && p.activityIds.includes("b")))
      .toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/schedule-engine/forwardPass.test.ts`
Expected: FAIL — `Failed to resolve import "./forwardPass"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/schedule-engine/forwardPass.ts`:

```ts
import { addWorkingTime, nextWorkingDay, resolveCalendar, subtractWorkingTime } from "./calendar";
import { applyForwardConstraint } from "./constraints";
import type { ScheduleGraph } from "./graph";
import { resolveProgress } from "./progress";
import type {
  ActivityInput, Calendar, DependencyInput, IsoDate, Problem, ScheduleInput,
} from "./types";

export interface EarlyDates {
  es: IsoDate;
  ef: IsoDate;
}

export interface ForwardPassResult {
  earlyDates: Map<string, EarlyDates>;
  projectFinish: IsoDate;
  violations: Problem[];
}

const max = (a: IsoDate, b: IsoDate): IsoDate => (a > b ? a : b);

/** Effective duration: milestones are always zero. */
function effectiveDuration(activity: ActivityInput): number {
  return activity.type === "milestone" ? 0 : activity.remainingDuration;
}

/** Shift `date` by `lag` working days (negative lag = a lead) on `calendar`. */
function applyLag(date: IsoDate, lag: number, calendar: Calendar): IsoDate {
  return lag >= 0
    ? addWorkingTime(date, lag, calendar)
    : subtractWorkingTime(date, -lag, calendar);
}

/**
 * The ES a single incoming relationship requires of its successor.
 * Lag is measured on the successor's calendar (locked decision).
 */
function esFromRelationship(
  dep: DependencyInput,
  predEarly: EarlyDates,
  successorDuration: number,
  successorCalendar: Calendar,
): IsoDate {
  switch (dep.type) {
    case "FS":
      return applyLag(predEarly.ef, dep.lag, successorCalendar);
    case "SS":
      return applyLag(predEarly.es, dep.lag, successorCalendar);
    case "FF": {
      const efFloor = applyLag(predEarly.ef, dep.lag, successorCalendar);
      return subtractWorkingTime(efFloor, successorDuration, successorCalendar);
    }
    case "SF": {
      const efFloor = applyLag(predEarly.es, dep.lag, successorCalendar);
      return subtractWorkingTime(efFloor, successorDuration, successorCalendar);
    }
  }
}

export function forwardPass(
  input: ScheduleInput,
  graph: ScheduleGraph,
  topoOrder: string[],
): ForwardPassResult {
  const byId = new Map(input.activities.map((a) => [a.id, a]));
  const earlyDates = new Map<string, EarlyDates>();
  const violations: Problem[] = [];

  for (const id of topoOrder) {
    const activity = byId.get(id) as ActivityInput;
    const calendar = resolveCalendar(activity, input.calendars, input.defaultCalendarId);
    const duration = effectiveDuration(activity);
    const progress = resolveProgress(activity, input.dataDate);

    if (progress.status === "complete") {
      earlyDates.set(id, {
        es: progress.pinnedStart as IsoDate,
        ef: progress.pinnedFinish as IsoDate,
      });
      continue;
    }

    // Logic-driven ES: the latest requirement across all incoming relationships.
    let logicEarlyStart = input.projectStart;
    for (const dep of graph.predecessors.get(id) ?? []) {
      const predEarly = earlyDates.get(dep.predecessorId);
      if (!predEarly) continue;
      logicEarlyStart = max(
        logicEarlyStart,
        esFromRelationship(dep, predEarly, duration, calendar),
      );
    }

    if (progress.status === "in_progress") {
      // ES is the actual start; remaining work schedules from the data-date floor.
      const es = progress.pinnedStart as IsoDate;
      let remainingStart = logicEarlyStart;
      if (progress.remainingFloor) remainingStart = max(remainingStart, progress.remainingFloor);
      remainingStart = nextWorkingDay(remainingStart, calendar);
      earlyDates.set(id, {
        es,
        ef: addWorkingTime(remainingStart, progress.remainingDuration, calendar),
      });
      continue;
    }

    // not_started: floor at the data date, apply forward constraints, normalize.
    let es = logicEarlyStart;
    if (progress.remainingFloor) es = max(es, progress.remainingFloor);
    const clamped = applyForwardConstraint(es, duration, activity.constraint, calendar);
    es = nextWorkingDay(clamped.earlyStart, calendar);
    if (clamped.violated) {
      violations.push({
        type: "constraint_violation",
        severity: "warning",
        activityIds: [id],
        message: `Constraint ${activity.constraint?.type} on '${id}' cannot be honored; network logic forces a later start.`,
      });
    }
    earlyDates.set(id, { es, ef: addWorkingTime(es, duration, calendar) });
  }

  let projectFinish = input.projectStart;
  for (const { ef } of earlyDates.values()) projectFinish = max(projectFinish, ef);

  return { earlyDates, projectFinish, violations };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/schedule-engine/forwardPass.test.ts`
Expected: PASS — all forward-pass tests green.

- [ ] **Step 5: Verify lint and typecheck pass**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schedule-engine/forwardPass.ts src/lib/schedule-engine/forwardPass.test.ts
git commit -m "feat: add CPM forward pass"
```

---

### Task 7: Backward pass — latest dates (`backwardPass.ts`)

Walks activities in reverse topological order computing `LF`/`LS`. Open-ended activities seed `LF = projectFinish`; backward constraints clamp `LF`.

**Files:**
- Create: `src/lib/schedule-engine/backwardPass.ts`
- Test: `src/lib/schedule-engine/backwardPass.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/schedule-engine/backwardPass.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { backwardPass } from "./backwardPass";
import { forwardPass } from "./forwardPass";
import { buildGraph, topologicalSort } from "./graph";
import type { ActivityInput, DependencyInput, ScheduleInput } from "./types";

const week = { id: "w", workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] };

function makeInput(activities: ActivityInput[], dependencies: DependencyInput[]): ScheduleInput {
  return {
    projectStart: "2026-06-01", dataDate: null, defaultCalendarId: "w",
    calendars: [week], activities, dependencies,
  };
}
function task(id: string, duration: number): ActivityInput {
  return { id, type: "task", originalDuration: duration, remainingDuration: duration };
}
function fs(id: string, p: string, s: string, lag = 0): DependencyInput {
  return { id, predecessorId: p, successorId: s, type: "FS", lag, isActive: true };
}

function run(input: ScheduleInput) {
  const graph = buildGraph(input.activities, input.dependencies);
  const topo = topologicalSort(input.activities, graph);
  const fwd = forwardPass(input, graph, topo);
  const bwd = backwardPass(input, graph, topo, fwd.projectFinish);
  return { fwd, bwd };
}

describe("backwardPass", () => {
  it("seeds a lone activity's late finish at the project finish", () => {
    const { fwd, bwd } = run(makeInput([task("a", 5)], []));
    expect(bwd.lateDates.get("a")?.lf).toBe(fwd.projectFinish);
    expect(bwd.lateDates.get("a")?.ls).toBe("2026-06-01");
  });

  it("makes a chain's predecessor late finish meet the successor late start", () => {
    const { bwd } = run(makeInput([task("a", 5), task("b", 3)], [fs("d", "a", "b")]));
    // b: LF = projectFinish 2026-06-11, LS = 2026-06-08; a: LF = 2026-06-08
    expect(bwd.lateDates.get("b")?.ls).toBe("2026-06-08");
    expect(bwd.lateDates.get("a")?.lf).toBe("2026-06-08");
  });

  it("takes the most restrictive requirement across multiple successors", () => {
    // a feeds b (long) and c (short); a's LF is bounded by the tighter successor
    const { bwd } = run(makeInput(
      [task("a", 2), task("b", 8), task("c", 2)],
      [fs("d1", "a", "b"), fs("d2", "a", "c")],
    ));
    // b drives projectFinish; c has float. a.LF = min(b.LS, c.LS) = b.LS
    const bLs = bwd.lateDates.get("b")?.ls as string;
    const cLs = bwd.lateDates.get("c")?.ls as string;
    expect(bwd.lateDates.get("a")?.lf).toBe(bLs < cLs ? bLs : cLs);
  });

  it("an FNLT constraint pulls the late finish in", () => {
    const { bwd } = run(makeInput(
      [{ id: "a", type: "task", originalDuration: 5, remainingDuration: 5,
         constraint: { type: "FNLT", date: "2026-06-05" } }],
      [],
    ));
    expect(bwd.lateDates.get("a")?.lf).toBe("2026-06-05");
  });

  it("flags an MFO constraint that logic cannot honor", () => {
    // a -> b chain; b has MFO earlier than its successors permit is not possible
    // here a has MFO far in the future while logic finish is earlier
    const { bwd } = run(makeInput(
      [task("a", 2), { id: "b", type: "task", originalDuration: 2, remainingDuration: 2,
        constraint: { type: "MFO", date: "2026-06-30" } }],
      [fs("d", "b", "a")],
    ));
    expect(bwd.violations.some((p) => p.type === "constraint_violation" && p.activityIds.includes("b")))
      .toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/schedule-engine/backwardPass.test.ts`
Expected: FAIL — `Failed to resolve import "./backwardPass"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/schedule-engine/backwardPass.ts`:

```ts
import { addWorkingTime, previousWorkingDay, resolveCalendar, subtractWorkingTime } from "./calendar";
import { applyBackwardConstraint } from "./constraints";
import type { ScheduleGraph } from "./graph";
import { resolveProgress } from "./progress";
import type {
  ActivityInput, Calendar, DependencyInput, IsoDate, Problem, ScheduleInput,
} from "./types";

export interface LateDates {
  ls: IsoDate;
  lf: IsoDate;
}

export interface BackwardPassResult {
  lateDates: Map<string, LateDates>;
  violations: Problem[];
}

const min = (a: IsoDate, b: IsoDate): IsoDate => (a < b ? a : b);

function effectiveDuration(activity: ActivityInput): number {
  return activity.type === "milestone" ? 0 : activity.remainingDuration;
}

/** Reverse of forward lag: shift back by `lag` working days on `calendar`. */
function removeLag(date: IsoDate, lag: number, calendar: Calendar): IsoDate {
  return lag >= 0
    ? subtractWorkingTime(date, lag, calendar)
    : addWorkingTime(date, -lag, calendar);
}

/**
 * The LF a single outgoing relationship requires of its predecessor.
 * `predDuration`/`predCalendar` belong to the predecessor; lag is measured on
 * the successor's calendar.
 */
function lfFromRelationship(
  dep: DependencyInput,
  successorLate: LateDates,
  predDuration: number,
  predCalendar: Calendar,
  successorCalendar: Calendar,
): IsoDate {
  switch (dep.type) {
    case "FS":
      return removeLag(successorLate.ls, dep.lag, successorCalendar);
    case "FF":
      return removeLag(successorLate.lf, dep.lag, successorCalendar);
    case "SS": {
      const predLs = removeLag(successorLate.ls, dep.lag, successorCalendar);
      return addWorkingTime(predLs, predDuration, predCalendar);
    }
    case "SF": {
      const predLs = removeLag(successorLate.lf, dep.lag, successorCalendar);
      return addWorkingTime(predLs, predDuration, predCalendar);
    }
  }
}

export function backwardPass(
  input: ScheduleInput,
  graph: ScheduleGraph,
  topoOrder: string[],
  projectFinish: IsoDate,
): BackwardPassResult {
  const byId = new Map(input.activities.map((a) => [a.id, a]));
  const calendarOf = (a: ActivityInput): Calendar =>
    resolveCalendar(a, input.calendars, input.defaultCalendarId);
  const lateDates = new Map<string, LateDates>();
  const violations: Problem[] = [];

  for (let i = topoOrder.length - 1; i >= 0; i -= 1) {
    const id = topoOrder[i];
    const activity = byId.get(id) as ActivityInput;
    const calendar = calendarOf(activity);
    const duration = effectiveDuration(activity);

    // Complete activities do not move; their late dates equal their actuals.
    const progress = resolveProgress(activity, input.dataDate);
    if (progress.status === "complete") {
      lateDates.set(id, {
        ls: progress.pinnedStart as IsoDate,
        lf: progress.pinnedFinish as IsoDate,
      });
      continue;
    }

    // Logic-driven LF: the most restrictive requirement across outgoing links.
    // An open end (no successors) seeds at the project finish.
    let logicLateFinish = projectFinish;
    for (const dep of graph.successors.get(id) ?? []) {
      const succLate = lateDates.get(dep.successorId);
      if (!succLate) continue;
      const succCalendar = calendarOf(byId.get(dep.successorId) as ActivityInput);
      logicLateFinish = min(
        logicLateFinish,
        lfFromRelationship(dep, succLate, duration, calendar, succCalendar),
      );
    }

    const clamped = applyBackwardConstraint(
      logicLateFinish, duration, activity.constraint, calendar,
    );
    if (clamped.violated) {
      violations.push({
        type: "constraint_violation",
        severity: "warning",
        activityIds: [id],
        message: `Constraint ${activity.constraint?.type} on '${id}' cannot be honored; network logic forces an earlier finish.`,
      });
    }
    const lf = previousWorkingDay(clamped.lateFinish, calendar);
    lateDates.set(id, { lf, ls: subtractWorkingTime(lf, duration, calendar) });
  }

  return { lateDates, violations };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/schedule-engine/backwardPass.test.ts`
Expected: PASS — all backward-pass tests green.

- [ ] **Step 5: Verify lint and typecheck pass**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schedule-engine/backwardPass.ts src/lib/schedule-engine/backwardPass.test.ts
git commit -m "feat: add CPM backward pass"
```

---

### Task 8: Float & critical-path flagging (`float.ts`)

**Files:**
- Create: `src/lib/schedule-engine/float.ts`
- Test: `src/lib/schedule-engine/float.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/schedule-engine/float.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { backwardPass } from "./backwardPass";
import { computeFloat } from "./float";
import { forwardPass } from "./forwardPass";
import { buildGraph, topologicalSort } from "./graph";
import type { ActivityInput, DependencyInput, ScheduleInput } from "./types";

const week = { id: "w", workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] };

function makeInput(activities: ActivityInput[], dependencies: DependencyInput[]): ScheduleInput {
  return {
    projectStart: "2026-06-01", dataDate: null, defaultCalendarId: "w",
    calendars: [week], activities, dependencies,
  };
}
function task(id: string, duration: number): ActivityInput {
  return { id, type: "task", originalDuration: duration, remainingDuration: duration };
}
function fs(id: string, p: string, s: string): DependencyInput {
  return { id, predecessorId: p, successorId: s, type: "FS", lag: 0, isActive: true };
}

function run(input: ScheduleInput) {
  const graph = buildGraph(input.activities, input.dependencies);
  const topo = topologicalSort(input.activities, graph);
  const fwd = forwardPass(input, graph, topo);
  const bwd = backwardPass(input, graph, topo, fwd.projectFinish);
  return computeFloat(input, graph, fwd.earlyDates, bwd.lateDates, 0);
}

describe("computeFloat", () => {
  it("gives a single chain zero total float and marks it critical", () => {
    const float = run(makeInput([task("a", 5), task("b", 3)], [fs("d", "a", "b")]));
    expect(float.get("a")?.totalFloat).toBe(0);
    expect(float.get("a")?.isCritical).toBe(true);
    expect(float.get("b")?.isCritical).toBe(true);
  });

  it("gives a parallel shorter activity positive total float", () => {
    // a(2) and b(8) both feed c(1). a has 6 working days of float.
    const float = run(makeInput(
      [task("a", 2), task("b", 8), task("c", 1)],
      [fs("d1", "a", "c"), fs("d2", "b", "c")],
    ));
    expect(float.get("a")?.totalFloat).toBe(6);
    expect(float.get("a")?.isCritical).toBe(false);
    expect(float.get("b")?.totalFloat).toBe(0);
    expect(float.get("b")?.isCritical).toBe(true);
  });

  it("computes free float as slack to the nearest successor", () => {
    const float = run(makeInput(
      [task("a", 2), task("b", 8), task("c", 1)],
      [fs("d1", "a", "c"), fs("d2", "b", "c")],
    ));
    // a finishes early; c cannot start until b finishes, so a has free float too
    expect(float.get("a")?.freeFloat).toBe(6);
  });

  it("an activity with no successors takes free float equal to total float", () => {
    const float = run(makeInput([task("a", 2), task("b", 8)], []));
    expect(float.get("a")?.freeFloat).toBe(float.get("a")?.totalFloat);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/schedule-engine/float.test.ts`
Expected: FAIL — `Failed to resolve import "./float"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/schedule-engine/float.ts`:

```ts
import { resolveCalendar, workingTimeBetween } from "./calendar";
import type { EarlyDates } from "./forwardPass";
import type { ScheduleGraph } from "./graph";
import type { LateDates } from "./backwardPass";
import type { ActivityInput, Calendar, DependencyInput, IsoDate, ScheduleInput } from "./types";

export interface ActivityFloat {
  totalFloat: number;
  freeFloat: number;
  isCritical: boolean;
}

/** Signed working days from `from` to `to`: negative when `to` is earlier. */
function signedWorkingDays(from: IsoDate, to: IsoDate, calendar: Calendar): number {
  return from <= to
    ? workingTimeBetween(from, to, calendar)
    : -workingTimeBetween(to, from, calendar);
}

function effectiveDuration(activity: ActivityInput): number {
  return activity.type === "milestone" ? 0 : activity.remainingDuration;
}

/** Slack a single relationship leaves before it would delay the successor. */
function freeFloatContribution(
  dep: DependencyInput,
  predEarly: EarlyDates,
  succEarly: EarlyDates,
  calendar: Calendar,
): number {
  switch (dep.type) {
    case "FS":
      return signedWorkingDays(predEarly.ef, succEarly.es, calendar) - dep.lag;
    case "SS":
      return signedWorkingDays(predEarly.es, succEarly.es, calendar) - dep.lag;
    case "FF":
      return signedWorkingDays(predEarly.ef, succEarly.ef, calendar) - dep.lag;
    case "SF":
      return signedWorkingDays(predEarly.es, succEarly.ef, calendar) - dep.lag;
  }
}

export function computeFloat(
  input: ScheduleInput,
  graph: ScheduleGraph,
  earlyDates: Map<string, EarlyDates>,
  lateDates: Map<string, LateDates>,
  criticalFloatThreshold: number,
): Map<string, ActivityFloat> {
  const result = new Map<string, ActivityFloat>();

  for (const activity of input.activities) {
    const calendar = resolveCalendar(activity, input.calendars, input.defaultCalendarId);
    const early = earlyDates.get(activity.id) as EarlyDates;
    const late = lateDates.get(activity.id) as LateDates;

    const totalFloat = signedWorkingDays(early.es, late.ls, calendar);

    const outgoing = graph.successors.get(activity.id) ?? [];
    let freeFloat = totalFloat;
    if (outgoing.length > 0) {
      freeFloat = Math.min(
        ...outgoing.map((dep) =>
          freeFloatContribution(
            dep, early, earlyDates.get(dep.successorId) as EarlyDates, calendar,
          ),
        ),
      );
    }

    result.set(activity.id, {
      totalFloat,
      freeFloat,
      isCritical: totalFloat <= criticalFloatThreshold,
    });
  }
  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/schedule-engine/float.test.ts`
Expected: PASS — all float tests green.

- [ ] **Step 5: Verify lint and typecheck pass**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schedule-engine/float.ts src/lib/schedule-engine/float.test.ts
git commit -m "feat: add float and critical-path computation"
```

---

### Task 9: Validation & the `calculate()` orchestrator (`index.ts`)

Wires the pipeline together and validates input. This is the engine's only public entry point.

**Files:**
- Create: `src/lib/schedule-engine/index.ts`
- Test: `src/lib/schedule-engine/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/schedule-engine/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { calculate } from "./index";
import type { ActivityInput, DependencyInput, ScheduleInput } from "./types";

const week = { id: "w", workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] };

function makeInput(
  activities: ActivityInput[],
  dependencies: DependencyInput[],
  overrides: Partial<ScheduleInput> = {},
): ScheduleInput {
  return {
    projectStart: "2026-06-01", dataDate: null, defaultCalendarId: "w",
    calendars: [week], activities, dependencies, ...overrides,
  };
}
function task(id: string, duration: number): ActivityInput {
  return { id, type: "task", originalDuration: duration, remainingDuration: duration };
}
function fs(id: string, p: string, s: string): DependencyInput {
  return { id, predecessorId: p, successorId: s, type: "FS", lag: 0, isActive: true };
}

describe("calculate", () => {
  it("schedules a simple chain end to end", () => {
    const result = calculate(makeInput([task("a", 5), task("b", 3)], [fs("d", "a", "b")]));
    // A valid chain still produces open-end warnings for its first/last activity;
    // assert only that nothing errored.
    expect(result.problems.some((p) => p.severity === "error")).toBe(false);
    expect(result.projectFinish).toBe("2026-06-11");
    const a = result.activities.find((x) => x.id === "a");
    expect(a?.earlyStart).toBe("2026-06-01");
    expect(a?.isCritical).toBe(true);
    expect(a?.plannedStart).toBe(a?.earlyStart);
  });

  it("is deterministic — identical input yields identical output", () => {
    const input = makeInput([task("a", 5), task("b", 3)], [fs("d", "a", "b")]);
    expect(calculate(input)).toEqual(calculate(input));
  });

  it("does not mutate the input", () => {
    const input = makeInput([task("a", 5)], []);
    const snapshot = JSON.stringify(input);
    calculate(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("reports a cycle and returns no dates", () => {
    const result = calculate(makeInput(
      [task("a", 1), task("b", 1)],
      [fs("d1", "a", "b"), fs("d2", "b", "a")],
    ));
    expect(result.projectFinish).toBeNull();
    expect(result.activities).toEqual([]);
    expect(result.problems.some((p) => p.type === "cycle")).toBe(true);
  });

  it("reports a dangling dependency reference as invalid input", () => {
    const result = calculate(makeInput([task("a", 1)], [fs("d", "a", "ghost")]));
    expect(result.projectFinish).toBeNull();
    expect(result.problems.some((p) => p.type === "invalid_input")).toBe(true);
  });

  it("reports a negative duration as invalid input", () => {
    const result = calculate(makeInput(
      [{ id: "a", type: "task", originalDuration: -1, remainingDuration: -1 }], [],
    ));
    expect(result.problems.some((p) => p.type === "invalid_input")).toBe(true);
  });

  it("reports a missing calendar reference as invalid input", () => {
    const result = calculate(makeInput(
      [{ id: "a", type: "task", originalDuration: 1, remainingDuration: 1, calendarId: "ghost" }],
      [],
    ));
    expect(result.problems.some((p) => p.type === "invalid_input")).toBe(true);
  });

  it("warns about open-ended activities", () => {
    const result = calculate(makeInput([task("a", 1), task("b", 1)], []));
    expect(result.problems.some((p) => p.type === "open_end")).toBe(true);
  });

  it("uses LS/LF as the planned dates for an ALAP activity", () => {
    const result = calculate(makeInput(
      [task("a", 2),
       { id: "b", type: "task", originalDuration: 2, remainingDuration: 2,
         constraint: { type: "ALAP", date: "2026-06-01" } }],
      [fs("d", "a", "b")],
    ));
    const b = result.activities.find((x) => x.id === "b");
    expect(b?.plannedStart).toBe(b?.lateStart);
    expect(b?.plannedFinish).toBe(b?.lateFinish);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/schedule-engine/index.test.ts`
Expected: FAIL — `Failed to resolve import "./index"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/schedule-engine/index.ts`:

```ts
import { backwardPass } from "./backwardPass";
import { computeFloat } from "./float";
import { forwardPass } from "./forwardPass";
import { buildGraph, detectCycles, topologicalSort } from "./graph";
import type {
  ActivityResult, Problem, ScheduleInput, ScheduleResult,
} from "./types";

export type { ScheduleInput, ScheduleResult, ActivityResult, Problem } from "./types";

const ACTIVITY_TYPES = new Set(["task", "milestone"]);
const DEPENDENCY_TYPES = new Set(["FS", "SS", "FF", "SF"]);
const CONSTRAINT_TYPES = new Set(["SNET", "SNLT", "FNET", "FNLT", "MSO", "MFO", "ALAP"]);

/** Structural checks. Any returned problem is fatal — calculate() stops. */
function validate(input: ScheduleInput): Problem[] {
  const problems: Problem[] = [];
  const add = (message: string, activityIds: string[] = []): void => {
    problems.push({ type: "invalid_input", severity: "error", activityIds, message });
  };

  const calendarIds = new Set(input.calendars.map((c) => c.id));
  if (!calendarIds.has(input.defaultCalendarId)) {
    add(`defaultCalendarId '${input.defaultCalendarId}' is not a defined calendar`);
  }
  for (const cal of input.calendars) {
    if (cal.workingWeekdays.length === 0) {
      add(`calendar '${cal.id}' has no working weekdays`);
    }
  }

  const activityIds = new Set<string>();
  for (const a of input.activities) {
    if (activityIds.has(a.id)) add(`duplicate activity id '${a.id}'`, [a.id]);
    activityIds.add(a.id);
    if (!ACTIVITY_TYPES.has(a.type)) add(`activity '${a.id}' has an invalid type`, [a.id]);
    if (a.originalDuration < 0 || a.remainingDuration < 0) {
      add(`activity '${a.id}' has a negative duration`, [a.id]);
    }
    if (a.percentComplete !== undefined && (a.percentComplete < 0 || a.percentComplete > 100)) {
      add(`activity '${a.id}' has a percentComplete outside 0-100`, [a.id]);
    }
    if (a.calendarId !== undefined && !calendarIds.has(a.calendarId)) {
      add(`activity '${a.id}' references unknown calendar '${a.calendarId}'`, [a.id]);
    }
    if (a.constraint && !CONSTRAINT_TYPES.has(a.constraint.type)) {
      add(`activity '${a.id}' has an invalid constraint type`, [a.id]);
    }
    const pct = a.percentComplete ?? 0;
    if (pct > 0 && !a.actualStart) {
      add(`activity '${a.id}' is in progress but has no actualStart`, [a.id]);
    }
    if (pct >= 100 && !a.actualFinish) {
      add(`activity '${a.id}' is complete but has no actualFinish`, [a.id]);
    }
  }

  const dependencyIds = new Set<string>();
  for (const d of input.dependencies) {
    if (dependencyIds.has(d.id)) add(`duplicate dependency id '${d.id}'`);
    dependencyIds.add(d.id);
    if (!DEPENDENCY_TYPES.has(d.type)) add(`dependency '${d.id}' has an invalid type`);
    if (!activityIds.has(d.predecessorId)) {
      add(`dependency '${d.id}' references unknown predecessor '${d.predecessorId}'`);
    }
    if (!activityIds.has(d.successorId)) {
      add(`dependency '${d.id}' references unknown successor '${d.successorId}'`);
    }
  }
  return problems;
}

/** Run the CPM pipeline. Always returns a result; never throws for data problems. */
export function calculate(input: ScheduleInput): ScheduleResult {
  const invalid = validate(input);
  if (invalid.length > 0) {
    return { activities: [], projectFinish: null, problems: invalid };
  }

  const graph = buildGraph(input.activities, input.dependencies);

  const cycles = detectCycles(input.activities, graph);
  if (cycles.length > 0) {
    return {
      activities: [],
      projectFinish: null,
      problems: cycles.map((chain) => ({
        type: "cycle" as const,
        severity: "error" as const,
        activityIds: chain,
        message: `Dependency cycle: ${chain.join(" -> ")} -> ${chain[0]}`,
      })),
    };
  }

  const topoOrder = topologicalSort(input.activities, graph);
  const forward = forwardPass(input, graph, topoOrder);
  const backward = backwardPass(input, graph, topoOrder, forward.projectFinish);
  const threshold = input.options?.criticalFloatThreshold ?? 0;
  const float = computeFloat(input, graph, forward.earlyDates, backward.lateDates, threshold);

  const problems: Problem[] = [...forward.violations, ...backward.violations];

  // Open-end warnings: no active predecessor or no active successor.
  for (const a of input.activities) {
    const hasPred = (graph.predecessors.get(a.id) ?? []).length > 0;
    const hasSucc = (graph.successors.get(a.id) ?? []).length > 0;
    if (!hasPred || !hasSucc) {
      problems.push({
        type: "open_end",
        severity: "warning",
        activityIds: [a.id],
        message: `Activity '${a.id}' is open-ended (${!hasPred ? "no predecessor" : ""}${!hasPred && !hasSucc ? ", " : ""}${!hasSucc ? "no successor" : ""}).`,
      });
    }
  }

  const activities: ActivityResult[] = input.activities.map((a) => {
    const early = forward.earlyDates.get(a.id);
    const late = backward.lateDates.get(a.id);
    const f = float.get(a.id);
    if (!early || !late || !f) {
      throw new Error(`internal: missing computed dates for '${a.id}'`);
    }
    const isAlap = a.constraint?.type === "ALAP";
    return {
      id: a.id,
      earlyStart: early.es,
      earlyFinish: early.ef,
      lateStart: late.ls,
      lateFinish: late.lf,
      plannedStart: isAlap ? late.ls : early.es,
      plannedFinish: isAlap ? late.lf : early.ef,
      totalFloat: f.totalFloat,
      freeFloat: f.freeFloat,
      isCritical: f.isCritical,
    };
  });

  return { activities, projectFinish: forward.projectFinish, problems };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/schedule-engine/index.test.ts`
Expected: PASS — all `calculate()` tests green.

- [ ] **Step 5: Verify lint and typecheck pass**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schedule-engine/index.ts src/lib/schedule-engine/index.test.ts
git commit -m "feat: add validation and the calculate() orchestrator"
```

---

### Task 10: WBS summary rollup (`rollup.ts`)

A separate pure module — not part of `calculate()`. Aggregates activity results up a WBS tree.

**Files:**
- Create: `src/lib/schedule-engine/rollup.ts`
- Test: `src/lib/schedule-engine/rollup.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/schedule-engine/rollup.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rollupWbs } from "./rollup";
import type { ActivityInput, ActivityResult, WbsNode } from "./types";

function activity(id: string, duration: number, pct: number): ActivityInput {
  return { id, type: "task", originalDuration: duration, remainingDuration: duration, percentComplete: pct };
}
function result(id: string, start: string, finish: string): ActivityResult {
  return {
    id, earlyStart: start, earlyFinish: finish, lateStart: start, lateFinish: finish,
    plannedStart: start, plannedFinish: finish, totalFloat: 0, freeFloat: 0, isCritical: true,
  };
}

describe("rollupWbs", () => {
  it("rolls a node's dates from the span of its activities", () => {
    const nodes: WbsNode[] = [{ id: "n1", parentId: null, activityIds: ["a", "b"] }];
    const activities = [activity("a", 5, 100), activity("b", 5, 0)];
    const results = [result("a", "2026-06-01", "2026-06-08"), result("b", "2026-06-08", "2026-06-15")];
    const [node] = rollupWbs(nodes, activities, results);
    expect(node.start).toBe("2026-06-01");
    expect(node.finish).toBe("2026-06-15");
  });

  it("computes a duration-weighted percent complete", () => {
    // a: 5 days @ 100%, b: 15 days @ 0% => (5*100 + 15*0) / 20 = 25
    const nodes: WbsNode[] = [{ id: "n1", parentId: null, activityIds: ["a", "b"] }];
    const activities = [activity("a", 5, 100), activity("b", 15, 0)];
    const results = [result("a", "2026-06-01", "2026-06-08"), result("b", "2026-06-08", "2026-06-29")];
    const [node] = rollupWbs(nodes, activities, results);
    expect(node.percentComplete).toBe(25);
  });

  it("rolls a parent node up from its child nodes", () => {
    const nodes: WbsNode[] = [
      { id: "root", parentId: null, activityIds: [] },
      { id: "c1", parentId: "root", activityIds: ["a"] },
      { id: "c2", parentId: "root", activityIds: ["b"] },
    ];
    const activities = [activity("a", 5, 100), activity("b", 5, 0)];
    const results = [result("a", "2026-06-01", "2026-06-08"), result("b", "2026-06-10", "2026-06-17")];
    const byId = new Map(rollupWbs(nodes, activities, results).map((r) => [r.nodeId, r]));
    expect(byId.get("root")?.start).toBe("2026-06-01");
    expect(byId.get("root")?.finish).toBe("2026-06-17");
    expect(byId.get("root")?.percentComplete).toBe(50);
  });

  it("returns null dates and zero percent for an empty node", () => {
    const nodes: WbsNode[] = [{ id: "n1", parentId: null, activityIds: [] }];
    const [node] = rollupWbs(nodes, [], []);
    expect(node).toEqual({ nodeId: "n1", start: null, finish: null, percentComplete: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/schedule-engine/rollup.test.ts`
Expected: FAIL — `Failed to resolve import "./rollup"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/schedule-engine/rollup.ts`:

```ts
import type { ActivityInput, ActivityResult, IsoDate, WbsNode, WbsRollup } from "./types";

/** Internal aggregate: a date span plus duration-weighted progress. */
interface Aggregate {
  start: IsoDate | null;
  finish: IsoDate | null;
  weightedPct: number; // sum of duration * percentComplete
  totalDuration: number;
}

const EMPTY: Aggregate = { start: null, finish: null, weightedPct: 0, totalDuration: 0 };

function merge(a: Aggregate, b: Aggregate): Aggregate {
  const start =
    a.start === null ? b.start : b.start === null ? a.start : a.start < b.start ? a.start : b.start;
  const finish =
    a.finish === null ? b.finish : b.finish === null ? a.finish : a.finish > b.finish ? a.finish : b.finish;
  return {
    start,
    finish,
    weightedPct: a.weightedPct + b.weightedPct,
    totalDuration: a.totalDuration + b.totalDuration,
  };
}

/**
 * Aggregate activity results up a WBS tree. A node's start/finish span all of
 * its descendant activities; percentComplete is duration-weighted. Detached
 * activities (not under any node) are simply not aggregated.
 */
export function rollupWbs(
  nodes: WbsNode[],
  activities: ActivityInput[],
  results: ActivityResult[],
): WbsRollup[] {
  const activityById = new Map(activities.map((a) => [a.id, a]));
  const resultById = new Map(results.map((r) => [r.id, r]));
  const childNodes = new Map<string, WbsNode[]>();
  for (const node of nodes) {
    if (node.parentId !== null) {
      const siblings = childNodes.get(node.parentId) ?? [];
      siblings.push(node);
      childNodes.set(node.parentId, siblings);
    }
  }

  const memo = new Map<string, Aggregate>();

  function aggregate(node: WbsNode): Aggregate {
    const cached = memo.get(node.id);
    if (cached) return cached;

    let acc: Aggregate = EMPTY;
    for (const activityId of node.activityIds) {
      const result = resultById.get(activityId);
      const activity = activityById.get(activityId);
      if (!result || !activity) continue;
      const duration = activity.originalDuration;
      acc = merge(acc, {
        start: result.plannedStart,
        finish: result.plannedFinish,
        weightedPct: duration * (activity.percentComplete ?? 0),
        totalDuration: duration,
      });
    }
    for (const child of childNodes.get(node.id) ?? []) {
      acc = merge(acc, aggregate(child));
    }

    memo.set(node.id, acc);
    return acc;
  }

  return nodes.map((node) => {
    const agg = aggregate(node);
    return {
      nodeId: node.id,
      start: agg.start,
      finish: agg.finish,
      percentComplete: agg.totalDuration === 0 ? 0 : agg.weightedPct / agg.totalDuration,
    };
  });
}
```

- [ ] **Step 4: Run the rollup test to verify it passes**

Run: `npm test -- src/lib/schedule-engine/rollup.test.ts`
Expected: PASS — all rollup tests green.

- [ ] **Step 5: Run the full engine suite**

Run: `npm test -- src/lib/schedule-engine`
Expected: PASS — every engine test green.

- [ ] **Step 6: Verify lint and typecheck pass**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/schedule-engine/rollup.ts src/lib/schedule-engine/rollup.test.ts
git commit -m "feat: add WBS summary rollup"
```

---

### Task 11: Golden-master tests

Hand-built schedules with every date and float asserted exactly. These are the regression backbone.

**Files:**
- Create: `src/lib/schedule-engine/golden/golden.test.ts`

- [ ] **Step 1: Write the golden-master tests**

Create `src/lib/schedule-engine/golden/golden.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the golden-master tests**

Run: `npm test -- src/lib/schedule-engine/golden`
Expected: PASS — all four golden-master suites green. If any date is off, the bug is in the engine — debug the responsible module, do not weaken the assertion.

- [ ] **Step 3: Verify lint and typecheck pass**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/schedule-engine/golden/golden.test.ts
git commit -m "test: add golden-master CPM schedules"
```

---

### Task 12: Property tests — randomized DAG invariants

Generates random acyclic schedules from a seeded RNG and asserts engine invariants hold for every one.

**Files:**
- Create: `src/lib/schedule-engine/property.test.ts`

- [ ] **Step 1: Write the property tests**

Create `src/lib/schedule-engine/property.test.ts`:

```ts
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
  const dependencies: DependencyInput[] = [];
  let depId = 0;
  for (let s = 1; s < count; s += 1) {
    for (let p = 0; p < s; p += 1) {
      if (next() < 0.35) {
        dependencies.push({
          id: `d${depId++}`,
          predecessorId: `a${p}`,
          successorId: `a${s}`,
          type: "FS",
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
```

- [ ] **Step 2: Run the property tests**

Run: `npm test -- src/lib/schedule-engine/property.test.ts`
Expected: PASS — both property suites green. A failure prints the seed; reproduce by calling `randomSchedule(seed)` and debug the engine.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — every test across the project green.

- [ ] **Step 4: Verify lint, typecheck, and build all pass**

Run: `npm run lint && npm run typecheck && npm run build`
Expected: all three exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedule-engine/property.test.ts
git commit -m "test: add randomized-DAG property tests for the CPM engine"
```

---

## Completion Criteria

- All twelve tasks complete; `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` exit 0.
- The engine schedules tasks and milestones across FS/SS/FF/SF relationships with positive, zero, and negative lag; applies SNET/SNLT/FNET/FNLT/MSO/MFO/ALAP constraints; honors calendars; handles progress and the data date; detects cycles; and reports problems without throwing.
- Golden-master and property tests pass, satisfying the Phase 1 exit check in `SCHEDULING-TOOL-PLAN.md` Section 8.
- `src/lib/schedule-engine/index.ts` exposes `calculate()` as the engine's public surface; `rollupWbs` is exported separately from `./rollup`. Both are ready for the Phase 2/3 database and server wiring.
