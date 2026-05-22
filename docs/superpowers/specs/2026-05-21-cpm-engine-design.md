# CPM Scheduling Engine (Phase 1) — Design Spec

> **Status:** Approved design. Ready to turn into an implementation plan.
> **Date:** 2026-05-21
> **Source:** `docs/SCHEDULING-TOOL-PLAN.md` Section 3 (the CPM engine) and Section 8 Phase 1.
> **Scope:** The pure CPM scheduling engine in isolation — no UI, no database. This is the correctness-critical core of the scheduling tool.

---

## Goal

Build the `schedule-engine/` module: a pure, framework-agnostic, deterministic TypeScript library that takes a schedule (activities, durations, dependencies, calendars, constraints, a data date) and computes the dates (early/late start/finish), float, and critical path. Same module runs on both client (optimistic preview) and server (authoritative recalc), so it must be pure and have no DB/HTTP/React imports.

Phase 0 (the Next.js + TypeScript + Vitest scaffold) is complete. This engine drops in under `src/lib/schedule-engine/` with no restructuring.

---

## Locked decisions

These were confirmed during brainstorming and are not open:

1. **Granularity:** day-based. Calendar helpers are written around a single "working-unit" abstraction so hour-based granularity can be added later without rewriting the passes.
2. **Lag calendar:** a relationship's lag is measured on the **successor's** calendar.
3. **Constraints are soft:** a constraint clamps computed dates and, when it cannot be honored without contradicting network logic, emits a warning. The engine never silently produces dates that violate the logic.
4. **Out-of-sequence progress:** uses **retained logic** (remaining work still respects the predecessor).
5. **Critical path:** `isCritical = totalFloat ≤ threshold`; threshold defaults to `0` and is configurable via input options.
6. **Resources:** the engine is resource-free in v1. Resource loading and leveling are deferred.
7. **WBS rollups:** computed by a separate pure module (`rollup.ts`), not part of the `calculate()` contract. Rollup is tree aggregation with no CPM math.
8. **Activity types:** the engine schedules **`task`** and **`milestone`** only. Level-of-effort (LOE) and `summary` activities are out of scope for the engine (summary nodes are handled by `rollup.ts`).
9. **Engine structure:** a pure pipeline of stage modules, one module per concern.
10. **Cycle handling:** **stop on cycle** — if any dependency loop exists, report it and return no dates (see Section 4).

---

## Section 1 — Module layout

Everything lands under `src/lib/schedule-engine/`. Pure TypeScript; no DB, HTTP, or React imports.

```
src/lib/schedule-engine/
  types.ts         // the input/output contract — all shared type defs
  calendar.ts      // addWorkingTime / subtractWorkingTime / workingTimeBetween
  graph.ts         // build adjacency, cycle detection, topological sort
  forwardPass.ts   // ES / EF
  backwardPass.ts  // LS / LF
  constraints.ts   // constraint clamp functions (called by the passes)
  progress.ts      // data-date / actuals handling (called by the forward pass)
  float.ts         // total float, free float, critical flagging
  rollup.ts        // WBS summary rollup — separate pure fn, not part of calculate()
  index.ts         // calculate(input) orchestrator + public exports
```

Tests co-locate as `*.test.ts` next to each module (Vitest's `include` is already `src/**/*.test.ts`). Hand-built golden-master fixtures live in `src/lib/schedule-engine/golden/`.

Each module is pure functions over plain data. Nothing mutates the input. The passes *call into* `calendar.ts`, `constraints.ts`, and `progress.ts` as helpers — constraints in particular must clamp dates *during* a pass so the effect propagates to successors, so they are not a separable post-stage.

---

## Section 2 — The data contract

The engine's public surface is one pure function:

```ts
function calculate(input: ScheduleInput): ScheduleResult
```

Dates cross the boundary as ISO `YYYY-MM-DD` strings. Durations, floats, and lags are integer **working days**.

### Input types

```ts
type IsoDate = string;                                  // 'YYYY-MM-DD'
type ActivityType   = 'task' | 'milestone';
type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';
type ConstraintType = 'SNET' | 'SNLT' | 'FNET' | 'FNLT' | 'MSO' | 'MFO' | 'ALAP';

interface CalendarException {
  date: IsoDate;
  working: boolean;          // false = holiday / non-work; true = special working day
}

interface Calendar {
  id: string;
  workingWeekdays: number[]; // subset of 0-6 (0 = Sunday)
  exceptions: CalendarException[];
}

interface ActivityConstraint {
  type: ConstraintType;
  date: IsoDate;             // ignored for ALAP
}

interface ActivityInput {
  id: string;
  type: ActivityType;
  originalDuration: number;  // working days, >= 0
  remainingDuration: number; // working days, >= 0
  calendarId?: string;       // overrides the project default calendar
  actualStart?: IsoDate;
  actualFinish?: IsoDate;
  percentComplete?: number;  // 0-100; defaults to 0
  constraint?: ActivityConstraint;   // at most one per activity (v1)
}

interface DependencyInput {
  id: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lag: number;               // working days, may be negative (a lead)
  isActive: boolean;         // inactive links are ignored for logic
}

interface ScheduleOptions {
  criticalFloatThreshold?: number;   // default 0
}

interface ScheduleInput {
  projectStart: IsoDate;
  dataDate: IsoDate | null;          // null = not started; pure forecast
  defaultCalendarId: string;
  calendars: Calendar[];
  activities: ActivityInput[];
  dependencies: DependencyInput[];
  options?: ScheduleOptions;
}
```

### Output types

```ts
interface ActivityResult {
  id: string;
  earlyStart: IsoDate;
  earlyFinish: IsoDate;
  lateStart: IsoDate;
  lateFinish: IsoDate;
  plannedStart: IsoDate;     // the dates the Gantt draws — normally ES/EF
  plannedFinish: IsoDate;
  totalFloat: number;        // working days
  freeFloat: number;         // working days
  isCritical: boolean;
}

type ProblemType     = 'invalid_input' | 'cycle' | 'constraint_violation' | 'open_end';
type ProblemSeverity = 'error' | 'warning';

interface Problem {
  type: ProblemType;
  severity: ProblemSeverity;
  activityIds: string[];     // the activities involved
  message: string;           // human-readable explanation
}

interface ScheduleResult {
  activities: ActivityResult[];
  projectFinish: IsoDate | null;     // null when the schedule is unsolvable
  problems: Problem[];
}
```

### Contract rules

- **One constraint per activity** for v1. The domain model allows a separate `Constraint` entity; the engine simplifies to one-per-activity (matches MS Project). Multiple constraints can be revisited later.
- The engine **never mutates the input** and **never throws** for schedule-data problems. Every issue — bad input, cycles, infeasible constraints — comes back in `problems[]`. It returns a `ScheduleResult` in all cases.
- The engine is **pure and deterministic**: same input → same output, no DB or network calls inside it.

### WBS rollup (separate module)

`rollup.ts` is shipped in Phase 1 but is not part of `calculate()`:

```ts
interface WbsNode {
  id: string;
  parentId: string | null;
  activityIds: string[];     // activities directly under this node
}

interface WbsRollup {
  nodeId: string;
  start: IsoDate | null;
  finish: IsoDate | null;
  percentComplete: number;   // duration-weighted
}

function rollupWbs(nodes: WbsNode[], activities: ActivityInput[], results: ActivityResult[]): WbsRollup[]
```

A node's `start` is the earliest child start, `finish` is the latest child finish, and `percentComplete` is the duration-weighted average of its children (`Σ(childDuration × child%) / Σ(childDuration)`). Nodes nest, so rollup resolves recursively from the leaves up.

---

## Section 3 — The algorithm pipeline

`calculate(input)` runs an ordered pipeline of pure stages:

**1. Validate.** Check referential integrity (every dependency endpoint and every `calendarId` resolves to a real entity), non-negative durations, valid enum values, `percentComplete` within 0–100, `defaultCalendarId` exists. Fatal issues are collected as `invalid_input` problems; the engine returns early with no computed dates.

**2. Build graph.** Construct predecessor/successor adjacency lists from `isActive: true` dependencies only. Inactive dependencies are ignored entirely for logic — they will render dashed in the UI but do not drive dates.

**3. Cycle detection.** Detect any dependency loops. If any exist, stop (see Section 4).

**4. Topological sort.** Order activities so every predecessor precedes its successors. The forward pass walks this order; the backward pass walks it reversed.

**5. Forward pass (earliest dates).** For each activity in topological order:
- `ES` = the **latest** requirement across all incoming active relationships:
  - **FS:** `ES ≥ predEF + lag`
  - **SS:** `ES ≥ predES + lag`
  - **FF:** `EF ≥ predEF + lag` → back-solve `ES`
  - **SF:** `EF ≥ predES + lag` → back-solve `ES`
- An activity with no predecessors gets `ES = projectStart`.
- Apply forward constraint clamps: **SNET/FNET** raise `ES`/`EF`; **MSO** pins the start date.
- Apply data-date / progress logic (see below).
- `EF = addWorkingTime(ES, remainingDuration, calendar)`. Milestones have zero duration, so `EF = ES`.
- Lag is applied in working time on the **successor's** calendar and may be negative (a lead).
- `projectFinish` = the maximum `EF` across all activities.

**6. Backward pass (latest dates).** For each activity in reverse topological order:
- Open-ended activities (no active successors) seed `LF = projectFinish` (or their own finish constraint).
- `LS`/`LF` = the **most restrictive** requirement across all outgoing active relationships (the FS/SS/FF/SF mirror of the forward rules).
- Apply backward constraint clamps: **SNLT/FNLT** lower `LS`/`LF` (which can create negative float); **MFO** pins the finish date; **ALAP** drives the activity from this pass.
- `LS = subtractWorkingTime(LF, remainingDuration, calendar)`.

**7. Float & critical.**
- `totalFloat = LS − ES` (in working days; equivalently `LF − EF`).
- `freeFloat` = the minimum slack to any successor's early start, computed per active relationship accounting for relationship type and lag. An activity with no successors takes `freeFloat = totalFloat`.
- `isCritical = totalFloat ≤ criticalFloatThreshold` (default 0). Negative float is kept, not clamped, and surfaces in the result.

**8. Assemble.** `plannedStart`/`plannedFinish` = `ES`/`EF`. Build `ActivityResult[]`, set `projectFinish`, and return with the accumulated `problems[]`.

### Progress, the data date, and retained logic

Applied within the forward pass:
- **Complete** activities (`percentComplete = 100`) use their `actualStart`/`actualFinish`, sit entirely left of the data date, and do not move.
- **In-progress** activities fix `actualStart` and schedule their `remainingDuration` forward from the data date.
- **Not-started** activities are forecast normally but cannot be scheduled before the data date.
- **Out-of-sequence** progress (an activity progressed before its predecessor finished) uses **retained logic**: the remaining work still respects the predecessor.
- When `dataDate` is `null`, the schedule is a pure forecast from `projectStart`.

### Calendar math

`calendar.ts` provides `addWorkingTime(date, units, calendar)`, `subtractWorkingTime(date, units, calendar)`, and `workingTimeBetween(start, finish, calendar)`. All arithmetic skips non-working days (weekends per `workingWeekdays`, holidays per `exceptions`). The math is day-based but written around a single "working-unit" abstraction so hour-based granularity can be added later without rewriting the passes.

---

## Section 4 — Error handling

The engine always returns a `ScheduleResult` and never throws for schedule-data issues. Problem types:

- **`invalid_input`** (error) — dangling dependency references, a missing or unresolvable calendar, a negative duration, an out-of-range `percentComplete`, or a bad enum value. The engine fails fast: it returns the problems with no computed dates and `projectFinish: null`.

- **`cycle`** (error) — a dependency loop makes CPM unsolvable. **Decision: stop on cycle.** The engine detects and reports every loop, each as a `cycle` problem listing the looped activity IDs, and returns `projectFinish: null` with no activity dates. Rationale: a cyclic schedule is broken as a whole, and partial dates would mislead. A partial-schedule mode (schedule the acyclic remainder) is a possible later enhancement.

- **`constraint_violation`** (warning) — a soft-constraint conflict. When a constraint cannot be honored without contradicting network logic (e.g., an `MSO` earlier than predecessors allow, or a deadline that forces negative float), the engine keeps logic-consistent dates and emits a warning. It never silently produces dates that violate the logic.

- **`open_end`** (warning) — an activity with no predecessor or no successor. Informational only; mirrors P6's open-end detection.

---

## Section 5 — Testing strategy

Vitest is already configured (`include: ['src/**/*.test.ts']`). Tests co-locate per module; golden-master fixtures live in `golden/`. This section is correctness-critical — the test suite is the definition of "done."

- **Calendar tests** — `addWorkingTime`/`subtractWorkingTime`/`workingTimeBetween` across weekends, holidays, special working days, and multi-calendar / lag-across-calendar cases.
- **Graph tests** — cycle detection (self-loop, multi-node loop, and confirming no false positives on a valid DAG); topological-sort correctness.
- **Relationship-type tests** — FS, SS, FF, SF, each with zero, positive, and negative lag.
- **Constraint tests** — each of the seven constraint types, including cases that create negative float and cases that emit `constraint_violation` warnings.
- **Progress tests** — data-date behavior, in-progress remaining-duration scheduling, complete activities staying fixed, and out-of-sequence retained logic.
- **Golden-master tests** — small hand-built schedules with `ES`/`EF`/`LS`/`LF`/`totalFloat`/`freeFloat` asserted exactly; a few cross-checked against MS Project / Primavera P6 output where available.
- **Property tests** — randomized DAGs from a seeded RNG, asserting invariants: `EF ≥ ES`, `LF ≥ LS`, `totalFloat = LS − ES`, the critical chain is continuous, and `projectFinish = max(EF)`.
- **Rollup tests** — parent `start`/`finish` derived from children, duration-weighted `percentComplete`, recursive nesting.

---

## Out of scope (deferred past Phase 1)

- Resource loading and leveling.
- Level-of-effort (LOE) activity scheduling.
- Hour-based (sub-day) granularity — the calendar abstraction leaves room for it.
- Incremental / dirty-subgraph recalculation — Phase 1 does a full recalc per call.
- Partial-schedule-on-cycle mode.
- MS Project (.MPP) / Primavera P6 (.XER) import.
- All UI and database integration.

## Done when

All test categories in Section 5 pass: golden-master and property tests hold for all four relationship types, lags (including negative), every constraint type, calendars, and progress / data-date behavior — with no UI and no DB. This satisfies Section 8's Phase 1 exit check.
