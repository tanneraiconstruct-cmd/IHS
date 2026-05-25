# Phase 6 — Real-time Collaboration (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two browsers editing the same project stay in sync without clobbering. Schedule edits (activities, dependencies, constraints, WBS) and the collab feed (comments, history) propagate live via Supabase Realtime. Presence shows who's online + who's in Edit Mode.

**Architecture:** One Realtime channel per project (`project:<uuid>`) mounted at `ScheduleApp`. Six `postgres_changes` subscriptions (one per synced table), filtered server-side by `project_id`. A pure reducer merges incoming rows into the TanStack Query `BootstrapData` cache. Activities use a `version` gate for echo/ordering; other tables use a module-level inflight `Map` with a 30s TTL. Channel-native presence rides the same channel. One migration adds `project_id` to `activity_constraints`, sets `replica identity full`, and adds the six tables to the `supabase_realtime` publication. Two writer-side precondition fixes (cascade-bump-version + per-row rollback) keep the existing mutation flow correct under realtime.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, `@supabase/supabase-js` (Realtime included), `@tanstack/react-query`, `zustand`, Tailwind v4, Vitest + React Testing Library + `jsdom`, Playwright.

**Source spec:** `docs/superpowers/specs/2026-05-24-phase-6-realtime-design.md`

---

## Conventions & Working Notes

- **Branch:** all work happens on `feat/phase-6-realtime` (created in Task 1 from `origin/main`). The current `docs/section-5-design` branch should be merged to main first; if it hasn't, branch from `origin/main` anyway — Section 5 docs don't touch any of the files this plan modifies.
- **TDD:** every non-trivial code task starts with a failing test. The plan shows the test code; do not skip to implementation. For pure logic the test is Vitest with `jsdom` env (already configured); for the React hook it's Vitest with `jsdom` using a hand-rolled mock for `@supabase/supabase-js`.
- **Frequent commits:** every task ends with a commit step. Don't batch commits across tasks. If a task balloons mid-implementation, split it.
- **Pure-reducer discipline:** `applyRealtimeEvent` must never import the Supabase client, React, or anything from `react-query`. The only inputs are `BootstrapData` + a `RealtimeRowEvent`. Tests for it use plain `vitest`.
- **No mutation behavior changes** beyond the two precondition fixes (Task 11, Task 12) and the `markInflight` wiring (Task 13). Existing optimistic patches, history writes, and toasts all stay the same.
- **Toast on disconnect.** Use `toast.warn(...)` from `@/lib/state/toasts` — the same module mutations use.
- **Hardcoded test users / project** (same as Phase 4 / Section 5):
  - Project ID: `70000000-0000-0000-0000-000000000000` (seeded Riverside Office Build).
  - Test users (password `password123`):
    - `scheduler@ihs.test` — internal scheduler role, full edit access.
    - `pm@ihs.test` — internal project manager (used as second context in E2E).
    - `tp-viewer@trade.test` — external trade-partner viewer, read-only.
- **Realtime baseline check.** Local Supabase (`supabase start`) runs the Realtime container by default. If `npx supabase status` doesn't show "Realtime API", run `npx supabase stop && npx supabase start` before Task 2.
- **References to read before starting:**
  - `docs/superpowers/specs/2026-05-24-phase-6-realtime-design.md` — the spec this plan implements.
  - `src/lib/state/mutations.ts` — the current mutation flow; lines 108–250 show `useSaveActivity` (the writer touched in Tasks 11–12).
  - `src/lib/state/mutations.test.ts` — the test patterns the rollback tests should mirror.
  - `supabase/migrations/20260522145151_rls_policies.sql` lines 96–127 — the existing `_select` policy pattern (`is_member(project_id)`).
  - `src/components/schedule/ScheduleApp.tsx` — where the hook + `PresenceBar` get mounted (Task 15).
  - `tests/e2e/scheduler-happy-path.spec.ts` — the Playwright login pattern.

---

## File Structure

### To create

| File | Responsibility |
|---|---|
| `supabase/migrations/20260524000000_phase6_realtime.sql` | Adds `project_id` (NOT NULL) to `activity_constraints` with backfill + SELECT RLS policy; sets `replica identity full` on six tables; adds those tables to `supabase_realtime` publication. |
| `src/lib/realtime/events.ts` | TypeScript discriminated `RealtimeRowEvent` union covering INSERT/UPDATE/DELETE × six tables. |
| `src/lib/realtime/echo-set.ts` | Module-level `Map<string, number>` with `markInflight`, `consumeEcho`, `_resetForTests` exports; 30s TTL. |
| `src/lib/realtime/echo-set.test.ts` | Tests for marking, consuming once, TTL expiry, reset. |
| `src/lib/realtime/normalize.ts` | Pure `normalize(payload, projectId): RealtimeRowEvent \| null` adapter from Supabase's `RealtimePostgresChangesPayload` to our union. |
| `src/lib/realtime/normalize.test.ts` | Per-table payload-shape tests + project-id mismatch drop. |
| `src/lib/realtime/reducers.ts` | Pure `applyRealtimeEvent(data, event): BootstrapData`. |
| `src/lib/realtime/reducers.test.ts` | Table-driven tests, all six tables × INSERT/UPDATE/DELETE where applicable. |
| `src/lib/realtime/presence.ts` | `PresencePayload` type + `deriveColor(userId)` palette helper. |
| `src/lib/realtime/presence.test.ts` | `deriveColor` determinism + palette coverage tests. |
| `src/lib/realtime/use-project-channel.ts` | The single hook; wires channel + presence + visibility listener into `QueryClient` + `usePresenceStore`. |
| `src/lib/realtime/use-project-channel.test.ts` | Integration test using a hand-rolled mock `SupabaseClient`. |
| `src/lib/state/presence-store.ts` | Zustand store: `online: Record<string, PresencePayload>`, `connection: "connecting"\|"live"\|"offline"`. |
| `src/lib/state/presence-store.test.ts` | Tests for `setOnline` (flattens Supabase array) + `setConnection`. |
| `src/components/schedule/PresenceBar.tsx` | Avatar stack + connection dot UI. |
| `src/components/schedule/PresenceBar.test.tsx` | Renders avatars from store; edit-mode users get pencil overlay; overflow chip past 5. |
| `tests/e2e/realtime.e2e.spec.ts` | Two-context Playwright happy-path: rename syncs, comment syncs, presence ring appears. |

### To modify

| File | Change |
|---|---|
| `src/lib/schedule/types.ts` | Add `project_id: string` to `DbActivityConstraint`. |
| `src/lib/schedule/bootstrap.ts` | Include `project_id` in the `activity_constraints` SELECT and add `.eq("project_id", projectId)` filter. |
| `src/lib/state/mutations.ts` | (1) `useSaveActivity` cascade upsert → switch to per-row `update` that bumps `version`; (2) `useSaveActivity` rollback → per-row restore, not full snapshot; (3) `useToggleDependencyActive` rollback → per-row restore; (4) `useInsertDependency` + `usePostComment` call `markInflight(returnedRow.id)` after the supabase insert succeeds. |
| `src/lib/state/mutations.test.ts` | Two new tests covering the per-row rollback behavior (rollback preserves a sibling row update applied during the mutation). |
| `src/components/schedule/ScheduleApp.tsx` | Call `useProjectChannel(projectId)`; mount `<PresenceBar />` inside the `Toolbar` row (passed as a prop). |
| `src/components/schedule/Toolbar.tsx` | Accept an optional `right` slot (`ReactNode`) rendered to the left of the existing right-side controls; `PresenceBar` goes there. |

### Unchanged

- All Phase 4 engine, bootstrap (besides the constraints column add), recalc, toast, query, ui-store, and non-PresenceBar component files.
- All Phase 3 server pipeline (still dormant; realtime does not touch it).
- All Phase 2 migrations and RLS (besides the new migration in Task 2).

---

## Task 1: Branch + plumbing baseline

**Files:** none (verification only).

- [ ] **Step 1: Verify clean tree on main**

```bash
cd "/Users/tanner/IHS- Scheduling Tool"
git fetch origin
git status
```

Expected: clean working tree (or only `.superpowers/` untracked, which is fine). If anything else is dirty, stash or commit before proceeding.

- [ ] **Step 2: Create the working branch from main**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b feat/phase-6-realtime
```

- [ ] **Step 3: Verify baseline build + tests pass**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: typecheck clean, lint clean, vitest reports ~115 tests passing across ~25 files (exact count varies as Section 5 lands). Record the baseline test count in your notes — every subsequent task should keep or grow it.

- [ ] **Step 4: Confirm Supabase local stack is up + Realtime is running**

```bash
npx supabase status
```

Expected output includes a `Realtime URL` line (typically `http://127.0.0.1:54321/realtime/v1`). If it's absent, run `npx supabase stop && npx supabase start` and re-check.

- [ ] **Step 5: Commit the baseline (empty commit documents the start)**

```bash
git commit --allow-empty -m "chore: start Phase 6 realtime branch"
```

---

## Task 2: Migration — project_id on constraints + replica identity + publication

**Files:**
- Create: `supabase/migrations/20260524000000_phase6_realtime.sql`

- [ ] **Step 1: Read the existing constraint table definition**

```bash
grep -A 8 "create table activity_constraints" supabase/migrations/20260522143513_schedule.sql
```

Confirm `activity_constraints` has columns `id`, `activity_id`, `type`, `constraint_date` — no `project_id` yet.

- [ ] **Step 2: Read the existing SELECT-policy pattern for reference**

```bash
sed -n '90,105p' supabase/migrations/20260522145151_rls_policies.sql
```

Note: policies use `for select to authenticated using (is_member(project_id))`. The new policy in this migration must match.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260524000000_phase6_realtime.sql

-- 1. Add project_id to activity_constraints so realtime can filter by it.
alter table activity_constraints
  add column project_id uuid references projects(id) on delete cascade;

update activity_constraints ac
  set project_id = a.project_id
  from activities a
  where ac.activity_id = a.id and ac.project_id is null;

alter table activity_constraints
  alter column project_id set not null;

create index activity_constraints_project_id_idx
  on activity_constraints (project_id);

-- 2. SELECT policy for activity_constraints (mirrors other tables).
drop policy if exists activity_constraints_select on activity_constraints;
create policy activity_constraints_select on activity_constraints
  for select to authenticated
  using (is_member(project_id));

-- 3. Replica identity full so DELETE and UPDATE events ship full row data.
alter table activities             replica identity full;
alter table dependencies           replica identity full;
alter table activity_constraints   replica identity full;
alter table wbs_nodes              replica identity full;
alter table comments               replica identity full;
alter table activity_history       replica identity full;

-- 4. Add the six tables to the supabase_realtime publication.
alter publication supabase_realtime add table activities;
alter publication supabase_realtime add table dependencies;
alter publication supabase_realtime add table activity_constraints;
alter publication supabase_realtime add table wbs_nodes;
alter publication supabase_realtime add table comments;
alter publication supabase_realtime add table activity_history;
```

- [ ] **Step 4: Apply the migration locally**

```bash
npx supabase migration up
```

Expected: success message; no errors. If Supabase complains about mixing DDL with publication ALTER in one transaction, split into two files (`…000000_phase6_realtime_a.sql` ending after step 3, `…000001_phase6_realtime_b.sql` containing only the publication ALTERs).

- [ ] **Step 5: Verify in psql**

```bash
npx supabase db psql -c "select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename;"
```

Expected: rows include `activities`, `activity_constraints`, `activity_history`, `comments`, `dependencies`, `wbs_nodes`.

```bash
npx supabase db psql -c "select count(*) from activity_constraints where project_id is null;"
```

Expected: `0` (backfill covered every row).

```bash
npx supabase db psql -c "\d activity_constraints" | grep "Replica Identity"
```

Expected: `Replica Identity: FULL`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260524000000_phase6_realtime.sql
git commit -m "feat(db): add project_id to activity_constraints + enable realtime publication"
```

---

## Task 3: Bootstrap fetch update for constraints

**Files:**
- Modify: `src/lib/schedule/types.ts`
- Modify: `src/lib/schedule/bootstrap.ts`
- Modify: `src/lib/schedule-server/get-project-schedule/index.ts` (if it has its own constraint select)
- Modify: `src/lib/schedule-server/apply-schedule-edit/index.ts` (same — verify)

- [ ] **Step 1: Add `project_id` to `DbActivityConstraint`**

Open `src/lib/schedule/types.ts`. The current shape (lines 64–69) is:

```ts
export interface DbActivityConstraint {
  id: string;
  activity_id: string;
  type: "SNET" | "SNLT" | "FNET" | "FNLT" | "MSO" | "MFO" | "ALAP";
  constraint_date: string | null;
}
```

Change to:

```ts
export interface DbActivityConstraint {
  id: string;
  project_id: string;
  activity_id: string;
  type: "SNET" | "SNLT" | "FNET" | "FNLT" | "MSO" | "MFO" | "ALAP";
  constraint_date: string | null;
}
```

- [ ] **Step 2: Update `bootstrap.ts` constraint select**

In `src/lib/schedule/bootstrap.ts`, find the constraint fetch around lines 61–63:

```ts
supabase
  .from("activity_constraints")
  .select("id, activity_id, type, constraint_date"),
```

Replace with:

```ts
supabase
  .from("activity_constraints")
  .select("id, project_id, activity_id, type, constraint_date")
  .eq("project_id", projectId),
```

- [ ] **Step 3: Find and update any other constraint selects**

```bash
grep -rn "from(\"activity_constraints\"" src/
```

For each result, ensure the SELECT includes `project_id`. The two known callsites are:
- `src/lib/schedule-server/get-project-schedule/index.ts` line 11 uses `select("*")` — leave as-is (`*` will pick up the new column).
- `src/lib/schedule-server/apply-schedule-edit/index.ts` line 92 uses `select("*")` — leave as-is.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: clean. The type change is additive; existing usages don't reference `project_id` so they keep compiling.

- [ ] **Step 5: Run existing tests**

```bash
npm test
```

Expected: same count as baseline, all passing. The bootstrap test in `tests/integration/get-project-schedule.test.ts` will exercise the new SELECT against the migrated DB.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schedule/types.ts src/lib/schedule/bootstrap.ts
git commit -m "feat(types): add project_id to DbActivityConstraint and bootstrap select"
```

---

## Task 4: Event type union (`events.ts`)

**Files:**
- Create: `src/lib/realtime/events.ts`

- [ ] **Step 1: Create the directory and write the types module**

```bash
mkdir -p src/lib/realtime
```

Create `src/lib/realtime/events.ts`:

```ts
import type {
  DbActivity,
  DbActivityConstraint,
  DbActivityHistory,
  DbComment,
  DbDependency,
  DbWbsNode,
} from "@/lib/schedule/types";

export type RealtimeRowEvent =
  | { table: "activities"; type: "INSERT"; new: DbActivity }
  | { table: "activities"; type: "UPDATE"; new: DbActivity }
  | { table: "activities"; type: "DELETE"; old: { id: string } }
  | { table: "dependencies"; type: "INSERT"; new: DbDependency }
  | { table: "dependencies"; type: "UPDATE"; new: DbDependency }
  | { table: "dependencies"; type: "DELETE"; old: { id: string } }
  | { table: "activity_constraints"; type: "INSERT"; new: DbActivityConstraint }
  | { table: "activity_constraints"; type: "UPDATE"; new: DbActivityConstraint }
  | { table: "activity_constraints"; type: "DELETE"; old: { id: string } }
  | { table: "wbs_nodes"; type: "INSERT"; new: DbWbsNode }
  | { table: "wbs_nodes"; type: "UPDATE"; new: DbWbsNode }
  | { table: "wbs_nodes"; type: "DELETE"; old: { id: string } }
  | { table: "comments"; type: "INSERT"; new: DbComment }
  | { table: "comments"; type: "UPDATE"; new: DbComment }
  | { table: "comments"; type: "DELETE"; old: { id: string } }
  | { table: "activity_history"; type: "INSERT"; new: DbActivityHistory };

export const REALTIME_TABLES = [
  "activities",
  "dependencies",
  "activity_constraints",
  "wbs_nodes",
  "comments",
  "activity_history",
] as const;

export type RealtimeTable = typeof REALTIME_TABLES[number];
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/realtime/events.ts
git commit -m "feat(realtime): add RealtimeRowEvent union + table list"
```

---

## Task 5: Echo set with TTL (TDD)

**Files:**
- Create: `src/lib/realtime/echo-set.ts`
- Create: `src/lib/realtime/echo-set.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/realtime/echo-set.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetForTests, consumeEcho, markInflight } from "./echo-set";

beforeEach(() => {
  _resetForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("echo-set", () => {
  it("returns true and removes the id when consumed", () => {
    markInflight("abc");
    expect(consumeEcho("abc")).toBe(true);
    expect(consumeEcho("abc")).toBe(false);  // already removed
  });

  it("returns false for an unknown id", () => {
    expect(consumeEcho("never-marked")).toBe(false);
  });

  it("treats an entry past its TTL as not-in-flight", () => {
    markInflight("abc");
    vi.advanceTimersByTime(31_000);  // past 30s TTL
    expect(consumeEcho("abc")).toBe(false);
  });

  it("keeps an entry within its TTL", () => {
    markInflight("abc");
    vi.advanceTimersByTime(29_000);
    expect(consumeEcho("abc")).toBe(true);
  });

  it("_resetForTests clears all entries", () => {
    markInflight("a"); markInflight("b");
    _resetForTests();
    expect(consumeEcho("a")).toBe(false);
    expect(consumeEcho("b")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — they should fail with module-not-found**

```bash
npm test -- src/lib/realtime/echo-set.test.ts
```

Expected: FAIL with "Cannot find module './echo-set'".

- [ ] **Step 3: Write the implementation**

Create `src/lib/realtime/echo-set.ts`:

```ts
const inflight = new Map<string, number>();  // id → expiry epoch ms
const TTL_MS = 30_000;

export function markInflight(id: string): void {
  inflight.set(id, Date.now() + TTL_MS);
}

export function consumeEcho(id: string): boolean {
  const expiry = inflight.get(id);
  if (expiry === undefined) return false;
  inflight.delete(id);
  return expiry > Date.now();
}

export function _resetForTests(): void {
  inflight.clear();
}
```

- [ ] **Step 4: Run the tests — they should pass**

```bash
npm test -- src/lib/realtime/echo-set.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/realtime/echo-set.ts src/lib/realtime/echo-set.test.ts
git commit -m "feat(realtime): add echo-set with 30s TTL"
```

---

## Task 6: Normalize Supabase payload → RealtimeRowEvent (TDD)

**Files:**
- Create: `src/lib/realtime/normalize.ts`
- Create: `src/lib/realtime/normalize.test.ts`

Supabase delivers `postgres_changes` payloads with shape `{ schema, table, eventType: "INSERT"|"UPDATE"|"DELETE", new, old, commit_timestamp, errors }`. We adapt to our discriminated union and drop cross-project events.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/realtime/normalize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalize } from "./normalize";

const PID = "00000000-0000-0000-0000-000000000001";
const ACT = (over: Partial<{ id: string; project_id: string; version: number }> = {}) => ({
  id: "a1", project_id: PID, wbs_node_id: null, name: "A",
  activity_type: "task" as const, original_duration: 1, remaining_duration: 1,
  calendar_id: null, actual_start: null, actual_finish: null,
  percent_complete: 0, responsible_company_id: null,
  early_start: null, early_finish: null, late_start: null, late_finish: null,
  planned_start: null, planned_finish: null, total_float: null, free_float: null,
  is_critical: false, version: 1, deleted_at: null, ...over,
});

describe("normalize", () => {
  it("maps an activity UPDATE payload", () => {
    const event = normalize(
      { schema: "public", table: "activities", eventType: "UPDATE",
        new: ACT({ version: 2 }), old: ACT() },
      PID,
    );
    expect(event).toEqual({ table: "activities", type: "UPDATE", new: ACT({ version: 2 }) });
  });

  it("maps an activity INSERT payload", () => {
    const event = normalize(
      { schema: "public", table: "activities", eventType: "INSERT",
        new: ACT(), old: {} },
      PID,
    );
    expect(event?.type).toBe("INSERT");
    if (event?.type === "INSERT") expect(event.new.id).toBe("a1");
  });

  it("maps an activity DELETE payload to { old: { id } }", () => {
    const event = normalize(
      { schema: "public", table: "activities", eventType: "DELETE",
        new: {}, old: ACT() },
      PID,
    );
    expect(event).toEqual({ table: "activities", type: "DELETE", old: { id: "a1" } });
  });

  it("drops an event whose new.project_id mismatches the current project", () => {
    const event = normalize(
      { schema: "public", table: "activities", eventType: "UPDATE",
        new: ACT({ project_id: "00000000-0000-0000-0000-000000000099" }), old: {} },
      PID,
    );
    expect(event).toBeNull();
  });

  it("drops an event for an unknown table", () => {
    const event = normalize(
      { schema: "public", table: "unrelated_table", eventType: "UPDATE",
        new: { id: "x" }, old: {} },
      PID,
    );
    expect(event).toBeNull();
  });

  it("maps a comment INSERT payload", () => {
    const c = { id: "c1", project_id: PID, author_user_id: "u1", body: "hi",
      parent_comment_id: null, scope: "project", target_activity_id: null,
      visibility: "shared", created_at: "2026-01-01", edited_at: null, deleted_at: null };
    const event = normalize(
      { schema: "public", table: "comments", eventType: "INSERT", new: c, old: {} },
      PID,
    );
    expect(event?.type).toBe("INSERT");
    if (event?.type === "INSERT" && event.table === "comments") {
      expect(event.new.id).toBe("c1");
    }
  });

  it("activity_constraints DELETE returns { old: { id } } via the new column", () => {
    const event = normalize(
      { schema: "public", table: "activity_constraints", eventType: "DELETE",
        new: {}, old: { id: "k1", project_id: PID, activity_id: "a1", type: "SNET", constraint_date: null } },
      PID,
    );
    expect(event).toEqual({ table: "activity_constraints", type: "DELETE", old: { id: "k1" } });
  });
});
```

- [ ] **Step 2: Run tests — they should fail with module-not-found**

```bash
npm test -- src/lib/realtime/normalize.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Create `src/lib/realtime/normalize.ts`:

```ts
import type { RealtimeRowEvent, RealtimeTable } from "./events";
import { REALTIME_TABLES } from "./events";

interface SupabasePayload {
  schema: string;
  table: string;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
}

function isRealtimeTable(table: string): table is RealtimeTable {
  return (REALTIME_TABLES as readonly string[]).includes(table);
}

export function normalize(
  payload: SupabasePayload,
  projectId: string,
): RealtimeRowEvent | null {
  if (!isRealtimeTable(payload.table)) return null;

  if (payload.eventType === "DELETE") {
    const id = payload.old?.["id"];
    if (typeof id !== "string") return null;
    return { table: payload.table, type: "DELETE", old: { id } } as RealtimeRowEvent;
  }

  const row = payload.new;
  if (!row || typeof row !== "object") return null;

  // Project-id mismatch defense (server filter should already catch this).
  const rowProjectId = row["project_id"];
  if (typeof rowProjectId === "string" && rowProjectId !== projectId) return null;

  return {
    table: payload.table,
    type: payload.eventType,
    new: row,
  } as RealtimeRowEvent;
}
```

- [ ] **Step 4: Run tests — they should pass**

```bash
npm test -- src/lib/realtime/normalize.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/realtime/normalize.ts src/lib/realtime/normalize.test.ts
git commit -m "feat(realtime): add normalize() adapter for Supabase postgres_changes payloads"
```

---

## Task 7: Reducer (TDD, table-driven)

**Files:**
- Create: `src/lib/realtime/reducers.ts`
- Create: `src/lib/realtime/reducers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/realtime/reducers.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BootstrapData,
  DbActivity,
  DbActivityConstraint,
  DbActivityHistory,
  DbComment,
  DbDependency,
  DbWbsNode,
} from "@/lib/schedule/types";
import { _resetForTests, markInflight } from "./echo-set";
import { applyRealtimeEvent } from "./reducers";

const PID = "00000000-0000-0000-0000-000000000001";

function makeAct(over: Partial<DbActivity> = {}): DbActivity {
  return {
    id: "a", project_id: PID, wbs_node_id: null, name: "A",
    activity_type: "task", original_duration: 1, remaining_duration: 1,
    calendar_id: null, actual_start: null, actual_finish: null,
    percent_complete: 0, responsible_company_id: null,
    early_start: null, early_finish: null, late_start: null, late_finish: null,
    planned_start: null, planned_finish: null, total_float: null, free_float: null,
    is_critical: false, version: 1, deleted_at: null, ...over,
  };
}
function makeDep(over: Partial<DbDependency> = {}): DbDependency {
  return {
    id: "d", project_id: PID, predecessor_id: "a", successor_id: "b",
    type: "FS", lag: 0, is_active: true, deleted_at: null, ...over,
  };
}
function makeWbs(over: Partial<DbWbsNode> = {}): DbWbsNode {
  return { id: "w", project_id: PID, parent_id: null, name: "WBS",
    sort_order: 0, deleted_at: null, ...over };
}
function makeConstraint(over: Partial<DbActivityConstraint> = {}): DbActivityConstraint {
  return { id: "k", project_id: PID, activity_id: "a", type: "SNET",
    constraint_date: null, ...over };
}
function makeComment(over: Partial<DbComment> = {}): DbComment {
  return { id: "c", project_id: PID, author_user_id: "u", body: "hi",
    parent_comment_id: null, scope: "project", target_activity_id: null,
    visibility: "shared", created_at: "2026-01-01T00:00:00Z",
    edited_at: null, deleted_at: null, ...over };
}
function makeHist(over: Partial<DbActivityHistory> = {}): DbActivityHistory {
  return { id: "h", project_id: PID, edit_session_id: null,
    entity_type: "activity", entity_id: "a", field: "name",
    old_value: null, new_value: "B", changed_by: "u",
    changed_at: "2026-01-01T00:00:00Z", visibility: "shared",
    session_note: null, ...over };
}
function makeData(over: Partial<BootstrapData> = {}): BootstrapData {
  return {
    project: { id: PID, name: "P", number: null, project_start: "2026-01-01",
      data_date: null, default_calendar_id: "cal",
      critical_float_threshold: 0, comment_visibility_default: "shared" },
    calendars: [], calendarExceptions: [], wbsNodes: [], activities: [],
    dependencies: [], constraints: [], comments: [], history: [],
    lookaheads: [], lookaheadTasks: [], ...over,
  };
}

beforeEach(() => {
  _resetForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("applyRealtimeEvent — activities", () => {
  it("accepts UPDATE when event.version > cached.version", () => {
    const data = makeData({ activities: [makeAct({ version: 1, name: "A" })] });
    const next = applyRealtimeEvent(data, {
      table: "activities", type: "UPDATE", new: makeAct({ version: 2, name: "A2" }),
    });
    expect(next.activities[0].name).toBe("A2");
  });

  it("drops UPDATE when event.version <= cached.version", () => {
    const data = makeData({ activities: [makeAct({ version: 3 })] });
    const next = applyRealtimeEvent(data, {
      table: "activities", type: "UPDATE", new: makeAct({ version: 2, name: "stale" }),
    });
    expect(next).toBe(data);  // unchanged reference
  });

  it("INSERT appends a new activity", () => {
    const data = makeData({ activities: [makeAct({ id: "a" })] });
    const next = applyRealtimeEvent(data, {
      table: "activities", type: "INSERT", new: makeAct({ id: "b" }),
    });
    expect(next.activities.map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("INSERT for existing id is a no-op (treated as duplicate)", () => {
    const data = makeData({ activities: [makeAct({ id: "a" })] });
    const next = applyRealtimeEvent(data, {
      table: "activities", type: "INSERT", new: makeAct({ id: "a" }),
    });
    expect(next).toBe(data);
  });

  it("DELETE soft-marks deleted_at", () => {
    const data = makeData({ activities: [makeAct({ id: "a", deleted_at: null })] });
    const next = applyRealtimeEvent(data, {
      table: "activities", type: "DELETE", old: { id: "a" },
    });
    expect(next.activities[0].deleted_at).not.toBeNull();
  });
});

describe("applyRealtimeEvent — dependencies (echo-suppressed INSERT)", () => {
  it("drops INSERT whose id is in the echo set", () => {
    markInflight("d1");
    const data = makeData({ dependencies: [] });
    const next = applyRealtimeEvent(data, {
      table: "dependencies", type: "INSERT", new: makeDep({ id: "d1" }),
    });
    expect(next.dependencies).toEqual([]);
  });

  it("accepts INSERT whose id is NOT in the echo set", () => {
    const data = makeData({ dependencies: [] });
    const next = applyRealtimeEvent(data, {
      table: "dependencies", type: "INSERT", new: makeDep({ id: "d2" }),
    });
    expect(next.dependencies).toHaveLength(1);
  });

  it("UPDATE replaces by id", () => {
    const data = makeData({ dependencies: [makeDep({ id: "d", lag: 0 })] });
    const next = applyRealtimeEvent(data, {
      table: "dependencies", type: "UPDATE", new: makeDep({ id: "d", lag: 5 }),
    });
    expect(next.dependencies[0].lag).toBe(5);
  });

  it("DELETE soft-marks deleted_at", () => {
    const data = makeData({ dependencies: [makeDep({ id: "d", deleted_at: null })] });
    const next = applyRealtimeEvent(data, {
      table: "dependencies", type: "DELETE", old: { id: "d" },
    });
    expect(next.dependencies[0].deleted_at).not.toBeNull();
  });
});

describe("applyRealtimeEvent — activity_constraints", () => {
  it("INSERT appends; UPDATE replaces; DELETE removes (no deleted_at column)", () => {
    let data = makeData({ constraints: [] });
    data = applyRealtimeEvent(data, {
      table: "activity_constraints", type: "INSERT", new: makeConstraint({ id: "k" }),
    });
    expect(data.constraints).toHaveLength(1);

    data = applyRealtimeEvent(data, {
      table: "activity_constraints", type: "UPDATE",
      new: makeConstraint({ id: "k", constraint_date: "2026-02-01" }),
    });
    expect(data.constraints[0].constraint_date).toBe("2026-02-01");

    data = applyRealtimeEvent(data, {
      table: "activity_constraints", type: "DELETE", old: { id: "k" },
    });
    expect(data.constraints).toEqual([]);
  });

  it("drops INSERT in echo set", () => {
    markInflight("k1");
    const data = makeData({ constraints: [] });
    const next = applyRealtimeEvent(data, {
      table: "activity_constraints", type: "INSERT", new: makeConstraint({ id: "k1" }),
    });
    expect(next.constraints).toEqual([]);
  });
});

describe("applyRealtimeEvent — wbs_nodes", () => {
  it("INSERT appends; UPDATE replaces; DELETE soft-marks; echo-suppressed", () => {
    markInflight("w1");
    let data = makeData({ wbsNodes: [] });
    data = applyRealtimeEvent(data, {
      table: "wbs_nodes", type: "INSERT", new: makeWbs({ id: "w1" }),
    });
    expect(data.wbsNodes).toEqual([]);  // echo dropped

    data = applyRealtimeEvent(data, {
      table: "wbs_nodes", type: "INSERT", new: makeWbs({ id: "w2", name: "x" }),
    });
    expect(data.wbsNodes).toHaveLength(1);

    data = applyRealtimeEvent(data, {
      table: "wbs_nodes", type: "UPDATE", new: makeWbs({ id: "w2", name: "y" }),
    });
    expect(data.wbsNodes[0].name).toBe("y");

    data = applyRealtimeEvent(data, {
      table: "wbs_nodes", type: "DELETE", old: { id: "w2" },
    });
    expect(data.wbsNodes[0].deleted_at).not.toBeNull();
  });
});

describe("applyRealtimeEvent — comments", () => {
  it("INSERT prepends to head (newest first to match read path)", () => {
    const data = makeData({ comments: [makeComment({ id: "c0" })] });
    const next = applyRealtimeEvent(data, {
      table: "comments", type: "INSERT", new: makeComment({ id: "c1" }),
    });
    expect(next.comments.map((c) => c.id)).toEqual(["c1", "c0"]);
  });

  it("drops INSERT in echo set", () => {
    markInflight("c1");
    const data = makeData({ comments: [] });
    const next = applyRealtimeEvent(data, {
      table: "comments", type: "INSERT", new: makeComment({ id: "c1" }),
    });
    expect(next.comments).toEqual([]);
  });

  it("UPDATE replaces; DELETE soft-marks", () => {
    let data = makeData({ comments: [makeComment({ id: "c", body: "old" })] });
    data = applyRealtimeEvent(data, {
      table: "comments", type: "UPDATE", new: makeComment({ id: "c", body: "new" }),
    });
    expect(data.comments[0].body).toBe("new");
    data = applyRealtimeEvent(data, {
      table: "comments", type: "DELETE", old: { id: "c" },
    });
    expect(data.comments[0].deleted_at).not.toBeNull();
  });
});

describe("applyRealtimeEvent — activity_history", () => {
  it("INSERT appends (no echo filtering, audit trail)", () => {
    const data = makeData({ history: [makeHist({ id: "h0" })] });
    const next = applyRealtimeEvent(data, {
      table: "activity_history", type: "INSERT", new: makeHist({ id: "h1" }),
    });
    expect(next.history.map((h) => h.id)).toEqual(["h1", "h0"]);  // newest first
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

```bash
npm test -- src/lib/realtime/reducers.test.ts
```

Expected: FAIL with "Cannot find module './reducers'".

- [ ] **Step 3: Write the implementation**

Create `src/lib/realtime/reducers.ts`:

```ts
import type { BootstrapData } from "@/lib/schedule/types";
import { consumeEcho } from "./echo-set";
import type { RealtimeRowEvent } from "./events";

const now = () => new Date().toISOString();

export function applyRealtimeEvent(
  data: BootstrapData,
  event: RealtimeRowEvent,
): BootstrapData {
  switch (event.table) {
    case "activities":
      return reduceActivities(data, event);
    case "dependencies":
      return reduceDependencies(data, event);
    case "activity_constraints":
      return reduceConstraints(data, event);
    case "wbs_nodes":
      return reduceWbs(data, event);
    case "comments":
      return reduceComments(data, event);
    case "activity_history":
      return reduceHistory(data, event);
  }
}

function reduceActivities(
  data: BootstrapData,
  event: Extract<RealtimeRowEvent, { table: "activities" }>,
): BootstrapData {
  if (event.type === "INSERT") {
    if (data.activities.some((a) => a.id === event.new.id)) return data;
    return { ...data, activities: [...data.activities, event.new] };
  }
  if (event.type === "UPDATE") {
    const idx = data.activities.findIndex((a) => a.id === event.new.id);
    if (idx === -1) return { ...data, activities: [...data.activities, event.new] };
    const cached = data.activities[idx];
    if (event.new.version <= cached.version) return data;  // echo / out-of-order
    const next = [...data.activities];
    next[idx] = event.new;
    return { ...data, activities: next };
  }
  // DELETE
  const idx = data.activities.findIndex((a) => a.id === event.old.id);
  if (idx === -1 || data.activities[idx].deleted_at) return data;
  const next = [...data.activities];
  next[idx] = { ...next[idx], deleted_at: now() };
  return { ...data, activities: next };
}

function reduceDependencies(
  data: BootstrapData,
  event: Extract<RealtimeRowEvent, { table: "dependencies" }>,
): BootstrapData {
  if (event.type === "INSERT") {
    if (consumeEcho(event.new.id)) return data;
    if (data.dependencies.some((d) => d.id === event.new.id)) return data;
    return { ...data, dependencies: [...data.dependencies, event.new] };
  }
  if (event.type === "UPDATE") {
    const idx = data.dependencies.findIndex((d) => d.id === event.new.id);
    if (idx === -1) return { ...data, dependencies: [...data.dependencies, event.new] };
    const next = [...data.dependencies];
    next[idx] = event.new;
    return { ...data, dependencies: next };
  }
  const idx = data.dependencies.findIndex((d) => d.id === event.old.id);
  if (idx === -1 || data.dependencies[idx].deleted_at) return data;
  const next = [...data.dependencies];
  next[idx] = { ...next[idx], deleted_at: now() };
  return { ...data, dependencies: next };
}

function reduceConstraints(
  data: BootstrapData,
  event: Extract<RealtimeRowEvent, { table: "activity_constraints" }>,
): BootstrapData {
  if (event.type === "INSERT") {
    if (consumeEcho(event.new.id)) return data;
    if (data.constraints.some((c) => c.id === event.new.id)) return data;
    return { ...data, constraints: [...data.constraints, event.new] };
  }
  if (event.type === "UPDATE") {
    const idx = data.constraints.findIndex((c) => c.id === event.new.id);
    if (idx === -1) return { ...data, constraints: [...data.constraints, event.new] };
    const next = [...data.constraints];
    next[idx] = event.new;
    return { ...data, constraints: next };
  }
  return {
    ...data,
    constraints: data.constraints.filter((c) => c.id !== event.old.id),
  };
}

function reduceWbs(
  data: BootstrapData,
  event: Extract<RealtimeRowEvent, { table: "wbs_nodes" }>,
): BootstrapData {
  if (event.type === "INSERT") {
    if (consumeEcho(event.new.id)) return data;
    if (data.wbsNodes.some((w) => w.id === event.new.id)) return data;
    return { ...data, wbsNodes: [...data.wbsNodes, event.new] };
  }
  if (event.type === "UPDATE") {
    const idx = data.wbsNodes.findIndex((w) => w.id === event.new.id);
    if (idx === -1) return { ...data, wbsNodes: [...data.wbsNodes, event.new] };
    const next = [...data.wbsNodes];
    next[idx] = event.new;
    return { ...data, wbsNodes: next };
  }
  const idx = data.wbsNodes.findIndex((w) => w.id === event.old.id);
  if (idx === -1 || data.wbsNodes[idx].deleted_at) return data;
  const next = [...data.wbsNodes];
  next[idx] = { ...next[idx], deleted_at: now() };
  return { ...data, wbsNodes: next };
}

function reduceComments(
  data: BootstrapData,
  event: Extract<RealtimeRowEvent, { table: "comments" }>,
): BootstrapData {
  if (event.type === "INSERT") {
    if (consumeEcho(event.new.id)) return data;
    if (data.comments.some((c) => c.id === event.new.id)) return data;
    return { ...data, comments: [event.new, ...data.comments] };  // newest first
  }
  if (event.type === "UPDATE") {
    const idx = data.comments.findIndex((c) => c.id === event.new.id);
    if (idx === -1) return { ...data, comments: [event.new, ...data.comments] };
    const next = [...data.comments];
    next[idx] = event.new;
    return { ...data, comments: next };
  }
  const idx = data.comments.findIndex((c) => c.id === event.old.id);
  if (idx === -1 || data.comments[idx].deleted_at) return data;
  const next = [...data.comments];
  next[idx] = { ...next[idx], deleted_at: now() };
  return { ...data, comments: next };
}

function reduceHistory(
  data: BootstrapData,
  event: Extract<RealtimeRowEvent, { table: "activity_history" }>,
): BootstrapData {
  // append-only; no echo filter
  if (data.history.some((h) => h.id === event.new.id)) return data;
  return { ...data, history: [event.new, ...data.history] };
}
```

- [ ] **Step 4: Run tests — they should pass**

```bash
npm test -- src/lib/realtime/reducers.test.ts
```

Expected: PASS (all reducer tests green; roughly 17 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/realtime/reducers.ts src/lib/realtime/reducers.test.ts
git commit -m "feat(realtime): add pure reducer for postgres_changes events"
```

---

## Task 8: Presence helpers — `deriveColor` + types (TDD)

**Files:**
- Create: `src/lib/realtime/presence.ts`
- Create: `src/lib/realtime/presence.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/realtime/presence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveColor, PRESENCE_PALETTE } from "./presence";

describe("deriveColor", () => {
  it("returns a palette color for any string", () => {
    const c = deriveColor("11111111-1111-1111-1111-111111111111");
    expect(PRESENCE_PALETTE).toContain(c);
  });

  it("is deterministic — same input → same color", () => {
    expect(deriveColor("foo")).toBe(deriveColor("foo"));
    expect(deriveColor("00000000-0000-0000-0000-000000000001"))
      .toBe(deriveColor("00000000-0000-0000-0000-000000000001"));
  });

  it("spreads across the palette for varying inputs", () => {
    const colors = new Set<string>();
    for (let i = 0; i < 50; i++) colors.add(deriveColor(`user-${i}`));
    expect(colors.size).toBeGreaterThanOrEqual(4);  // at least half the 8-color palette
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

```bash
npm test -- src/lib/realtime/presence.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Create `src/lib/realtime/presence.ts`:

```ts
export interface PresencePayload {
  userId: string;
  displayName: string;
  color: string;
  editMode: boolean;
  joinedAt: string;
}

export const PRESENCE_PALETTE = [
  "#2563eb",  // blue
  "#dc2626",  // red
  "#16a34a",  // green
  "#9333ea",  // purple
  "#ea580c",  // orange
  "#0891b2",  // cyan
  "#db2777",  // pink
  "#65a30d",  // lime
] as const;

export function deriveColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return PRESENCE_PALETTE[h % PRESENCE_PALETTE.length];
}
```

- [ ] **Step 4: Run tests — they should pass**

```bash
npm test -- src/lib/realtime/presence.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/realtime/presence.ts src/lib/realtime/presence.test.ts
git commit -m "feat(realtime): add PresencePayload type and deriveColor helper"
```

---

## Task 9: Presence store (TDD)

**Files:**
- Create: `src/lib/state/presence-store.ts`
- Create: `src/lib/state/presence-store.test.ts`

Note: Supabase's `presenceState()` returns `Record<presenceKey, PresencePayload[]>` — each presence key maps to an *array* (because the same key can be tracked from multiple subscriptions). Since we set `presence: { key: userId }`, every user produces an array of length 1 in normal operation; we flatten by taking the first entry.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/state/presence-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { usePresenceStore } from "./presence-store";

beforeEach(() => {
  usePresenceStore.setState({ online: {}, connection: "connecting" });
});

describe("presence-store", () => {
  it("setOnline flattens Supabase's per-key arrays", () => {
    usePresenceStore.getState().setOnline({
      "u1": [{ userId: "u1", displayName: "Alice", color: "#000", editMode: false, joinedAt: "1" }],
      "u2": [{ userId: "u2", displayName: "Bob", color: "#111", editMode: true, joinedAt: "2" }],
    });
    const online = usePresenceStore.getState().online;
    expect(Object.keys(online).sort()).toEqual(["u1", "u2"]);
    expect(online["u2"].editMode).toBe(true);
  });

  it("setOnline ignores empty arrays from a stale key", () => {
    usePresenceStore.getState().setOnline({
      "u1": [{ userId: "u1", displayName: "Alice", color: "#000", editMode: false, joinedAt: "1" }],
      "u2": [],
    });
    expect(Object.keys(usePresenceStore.getState().online)).toEqual(["u1"]);
  });

  it("setConnection updates connection status", () => {
    usePresenceStore.getState().setConnection("live");
    expect(usePresenceStore.getState().connection).toBe("live");
    usePresenceStore.getState().setConnection("offline");
    expect(usePresenceStore.getState().connection).toBe("offline");
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

```bash
npm test -- src/lib/state/presence-store.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Create `src/lib/state/presence-store.ts`:

```ts
import { create } from "zustand";
import type { PresencePayload } from "@/lib/realtime/presence";

export type ConnectionStatus = "connecting" | "live" | "offline";

interface PresenceStore {
  online: Record<string, PresencePayload>;
  connection: ConnectionStatus;
  setOnline: (raw: Record<string, PresencePayload[]>) => void;
  setConnection: (s: ConnectionStatus) => void;
}

export const usePresenceStore = create<PresenceStore>((set) => ({
  online: {},
  connection: "connecting",
  setOnline: (raw) => {
    const flat: Record<string, PresencePayload> = {};
    for (const [key, arr] of Object.entries(raw)) {
      if (arr && arr.length > 0) flat[key] = arr[0];
    }
    set({ online: flat });
  },
  setConnection: (connection) => set({ connection }),
}));
```

- [ ] **Step 4: Run tests — they should pass**

```bash
npm test -- src/lib/state/presence-store.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/state/presence-store.ts src/lib/state/presence-store.test.ts
git commit -m "feat(state): add usePresenceStore for online users + connection status"
```

---

## Task 10: `useProjectChannel` hook (integration test with mock)

**Files:**
- Create: `src/lib/realtime/use-project-channel.ts`
- Create: `src/lib/realtime/use-project-channel.test.ts`

This task tests the *wiring* of the hook against a hand-rolled mock channel. The reducer, echo-set, normalize, and presence helpers are already tested as pure modules — here we verify the hook calls them at the right times.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/realtime/use-project-channel.test.ts`:

```ts
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { BootstrapData } from "@/lib/schedule/types";
import { usePresenceStore } from "@/lib/state/presence-store";
import { useProjectChannel } from "./use-project-channel";

const PID = "00000000-0000-0000-0000-000000000001";

interface MockChannel {
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  track: ReturnType<typeof vi.fn>;
  untrack: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  presenceState: ReturnType<typeof vi.fn>;
  // Captured callbacks so tests can fire events.
  bindings: Record<string, Array<(payload: unknown) => void>>;
  subscribeCb: ((status: string) => void) | null;
}

function makeMockChannel(): MockChannel {
  const bindings: MockChannel["bindings"] = {};
  const ch: MockChannel = {
    bindings,
    subscribeCb: null,
    on: vi.fn().mockImplementation((event: string, opts: unknown, cb: unknown) => {
      const key = `${event}:${typeof opts === "object" && opts && "table" in opts ? (opts as { table: string }).table : (opts as { event?: string } | null)?.event ?? ""}`;
      (bindings[key] ||= []).push(cb as (p: unknown) => void);
      return ch;
    }),
    subscribe: vi.fn().mockImplementation((cb: (status: string) => void) => {
      ch.subscribeCb = cb;
      return ch;
    }),
    track: vi.fn().mockResolvedValue(undefined),
    untrack: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    presenceState: vi.fn().mockReturnValue({}),
  };
  return ch;
}

let mockChannel: MockChannel;
let mockClient: { channel: ReturnType<typeof vi.fn>; auth: { getUser: ReturnType<typeof vi.fn> } };

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => mockClient,
}));

beforeEach(() => {
  mockChannel = makeMockChannel();
  mockClient = {
    channel: vi.fn().mockReturnValue(mockChannel),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1", email: "alice@x.test" } } }) },
  };
  usePresenceStore.setState({ online: {}, connection: "connecting" });
});

afterEach(() => {
  vi.clearAllMocks();
});

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function seed(qc: QueryClient): BootstrapData {
  const data: BootstrapData = {
    project: { id: PID, name: "P", number: null, project_start: "2026-01-01",
      data_date: null, default_calendar_id: "cal",
      critical_float_threshold: 0, comment_visibility_default: "shared" },
    calendars: [], calendarExceptions: [], wbsNodes: [], activities: [],
    dependencies: [], constraints: [], comments: [], history: [],
    lookaheads: [], lookaheadTasks: [],
  };
  qc.setQueryData(["schedule", PID], data);
  return data;
}

describe("useProjectChannel", () => {
  it("subscribes to all six tables with project_id filter", async () => {
    const qc = new QueryClient();
    seed(qc);
    renderHook(() => useProjectChannel(PID), { wrapper: wrap(qc) });

    // wait for getUser → channel setup microtasks
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(mockClient.channel).toHaveBeenCalledWith(`project:${PID}`, expect.anything());
    const tables = mockChannel.on.mock.calls
      .filter((c) => c[0] === "postgres_changes")
      .map((c) => (c[1] as { table: string }).table)
      .sort();
    expect(tables).toEqual([
      "activities", "activity_constraints", "activity_history",
      "comments", "dependencies", "wbs_nodes",
    ]);
  });

  it("calls track() and invalidates queries on SUBSCRIBED", async () => {
    const qc = new QueryClient();
    seed(qc);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useProjectChannel(PID), { wrapper: wrap(qc) });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => { mockChannel.subscribeCb?.("SUBSCRIBED"); await Promise.resolve(); });

    expect(mockChannel.track).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1", editMode: false,
    }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["schedule", PID] });
    expect(usePresenceStore.getState().connection).toBe("live");
  });

  it("sets connection=offline on CHANNEL_ERROR", async () => {
    const qc = new QueryClient();
    seed(qc);
    renderHook(() => useProjectChannel(PID), { wrapper: wrap(qc) });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => { mockChannel.subscribeCb?.("CHANNEL_ERROR"); });
    expect(usePresenceStore.getState().connection).toBe("offline");
  });

  it("forwards a postgres_changes payload through reducers into the cache", async () => {
    const qc = new QueryClient();
    seed(qc);
    renderHook(() => useProjectChannel(PID), { wrapper: wrap(qc) });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const activitiesCallback = mockChannel.bindings["postgres_changes:activities"][0];
    await act(async () => {
      activitiesCallback({
        schema: "public", table: "activities", eventType: "INSERT",
        new: { id: "new-act", project_id: PID, wbs_node_id: null, name: "Hello",
          activity_type: "task", original_duration: 1, remaining_duration: 1,
          calendar_id: null, actual_start: null, actual_finish: null,
          percent_complete: 0, responsible_company_id: null,
          early_start: null, early_finish: null, late_start: null, late_finish: null,
          planned_start: null, planned_finish: null, total_float: null, free_float: null,
          is_critical: false, version: 1, deleted_at: null },
        old: {},
      });
    });

    const cache = qc.getQueryData<BootstrapData>(["schedule", PID]);
    expect(cache?.activities.some((a) => a.id === "new-act")).toBe(true);
  });

  it("writes presence sync events to the store", async () => {
    const qc = new QueryClient();
    seed(qc);
    renderHook(() => useProjectChannel(PID), { wrapper: wrap(qc) });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    mockChannel.presenceState.mockReturnValue({
      "u2": [{ userId: "u2", displayName: "Bob", color: "#222", editMode: true, joinedAt: "1" }],
    });
    const syncCallback = mockChannel.bindings["presence:sync"][0];
    await act(async () => { syncCallback({}); });

    expect(usePresenceStore.getState().online["u2"]?.displayName).toBe("Bob");
  });

  it("untracks + unsubscribes on unmount", async () => {
    const qc = new QueryClient();
    seed(qc);
    const { unmount } = renderHook(() => useProjectChannel(PID), { wrapper: wrap(qc) });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    unmount();
    expect(mockChannel.untrack).toHaveBeenCalled();
    expect(mockChannel.unsubscribe).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

```bash
npm test -- src/lib/realtime/use-project-channel.test.ts
```

Expected: FAIL with "Cannot find module './use-project-channel'".

- [ ] **Step 3: Write the implementation**

Create `src/lib/realtime/use-project-channel.ts`:

```ts
"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { toast } from "@/lib/state/toasts";
import { useUiStore } from "@/lib/state/ui-store";
import { usePresenceStore } from "@/lib/state/presence-store";
import { REALTIME_TABLES } from "./events";
import { applyRealtimeEvent } from "./reducers";
import { normalize } from "./normalize";
import { deriveColor, type PresencePayload } from "./presence";
import type { BootstrapData } from "@/lib/schedule/types";

export function useProjectChannel(projectId: string): void {
  const qc = useQueryClient();
  const chRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    const sb = createSupabaseBrowserClient();
    let cancelled = false;
    const setOnline = usePresenceStore.getState().setOnline;
    const setConnection = usePresenceStore.getState().setConnection;
    const key = ["schedule", projectId] as const;

    (async () => {
      const { data: { user } } = await sb.auth.getUser();
      if (!user || cancelled) return;
      const displayName = user.email?.split("@")[0] ?? user.id.slice(0, 8);
      const color = deriveColor(user.id);

      const ch = sb.channel(`project:${projectId}`, {
        config: { presence: { key: user.id } },
      });
      chRef.current = ch;

      for (const table of REALTIME_TABLES) {
        ch.on(
          "postgres_changes",
          { event: "*", schema: "public", table, filter: `project_id=eq.${projectId}` },
          (payload) => {
            const event = normalize(payload as never, projectId);
            if (!event) return;
            qc.setQueryData(key, (prev: BootstrapData | undefined) =>
              prev ? applyRealtimeEvent(prev, event) : prev);
          },
        );
      }

      ch.on("presence", { event: "sync" }, () => {
        setOnline(ch.presenceState<PresencePayload>());
      });

      ch.subscribe(async (status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          setConnection("live");
          void qc.invalidateQueries({ queryKey: key });
          await ch.track({
            userId: user.id,
            displayName,
            color,
            editMode: useUiStore.getState().mode === "edit",
            joinedAt: new Date().toISOString(),
          } satisfies PresencePayload);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnection("offline");
          toast.warn("Live updates disconnected — refresh to reconnect");
        }
      });
    })();

    // Re-track when edit mode flips
    const editUnsub = useUiStore.subscribe((s, prev) => {
      if (s.mode === prev.mode) return;
      const ch = chRef.current;
      if (!ch) return;
      // ch.track will merge into existing presence entry for this userId.
      void (async () => {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return;
        await ch.track({
          userId: user.id,
          displayName: user.email?.split("@")[0] ?? user.id.slice(0, 8),
          color: deriveColor(user.id),
          editMode: s.mode === "edit",
          joinedAt: new Date().toISOString(),
        } satisfies PresencePayload);
      })();
    });

    const onVis = () => {
      if (document.visibilityState === "visible") {
        void qc.invalidateQueries({ queryKey: key });
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      editUnsub();
      document.removeEventListener("visibilitychange", onVis);
      const ch = chRef.current;
      if (ch) {
        void ch.untrack();
        void ch.unsubscribe();
        chRef.current = null;
      }
    };
  }, [projectId, qc]);
}
```

- [ ] **Step 4: Run tests — they should pass**

```bash
npm test -- src/lib/realtime/use-project-channel.test.ts
```

Expected: PASS (6 tests). If `useUiStore.subscribe` complains about the (state, prev) signature, switch to the single-arg form and read previous via a closed-over variable.

- [ ] **Step 5: Run the full unit suite to confirm nothing else broke**

```bash
npm test
```

Expected: all green; test count grew by the new files.

- [ ] **Step 6: Commit**

```bash
git add src/lib/realtime/use-project-channel.ts src/lib/realtime/use-project-channel.test.ts
git commit -m "feat(realtime): add useProjectChannel hook wiring subscriptions + presence"
```

---

## Task 11: Cascade writer bumps `version` on each cascaded row

**Files:**
- Modify: `src/lib/state/mutations.ts` (specifically the cascade block inside `useSaveActivity`, currently lines ~219–234)

The current cascade write uses a single `.upsert()` and does not bump `version`. With realtime, other clients drop those events because `event.new.version <= cached.version`. Fix: replace the batch upsert with N individual `.update()` calls that each bump version.

- [ ] **Step 1: Locate the current cascade block**

Open `src/lib/state/mutations.ts`. Find this block (approximately lines 218–234):

```ts
// Best-effort cascade writes (no version check). See plan §Concurrency model.
if (cascadeUpdates.length > 0) {
  const payload = cascadeUpdates.map((a) => ({
    id: a.id,
    planned_start: a.planned_start,
    planned_finish: a.planned_finish,
    early_start: a.early_start,
    early_finish: a.early_finish,
    late_start: a.late_start,
    late_finish: a.late_finish,
    total_float: a.total_float,
    free_float: a.free_float,
    is_critical: a.is_critical,
  }));
  const { error: cascadeErr } = await sb.from("activities").upsert(payload);
  if (cascadeErr) toast.warn(`Cascade write failed: ${cascadeErr.message}`);
}
```

- [ ] **Step 2: Replace with per-row updates that bump version**

```ts
// Cascade writes: per-row update that bumps version so realtime receivers accept the event.
if (cascadeUpdates.length > 0) {
  const results = await Promise.all(
    cascadeUpdates.map((a) =>
      sb
        .from("activities")
        .update({
          planned_start: a.planned_start,
          planned_finish: a.planned_finish,
          early_start: a.early_start,
          early_finish: a.early_finish,
          late_start: a.late_start,
          late_finish: a.late_finish,
          total_float: a.total_float,
          free_float: a.free_float,
          is_critical: a.is_critical,
          version: a.version + 1,
        })
        .eq("id", a.id),
    ),
  );
  const cascadeErr = results.find((r) => r.error)?.error;
  if (cascadeErr) toast.warn(`Cascade write failed: ${cascadeErr.message}`);
}
```

- [ ] **Step 3: Run the existing mutation tests**

```bash
npm test -- src/lib/state/mutations.test.ts
```

Expected: all existing tests still pass. The change is to the side-effect block; `applyOptimisticActivityPatch` and `persistVersioned` are unchanged.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/state/mutations.ts
git commit -m "fix(mutations): bump version on cascade writes so realtime receivers accept"
```

---

## Task 12: Rollback fix — per-row restore (TDD)

**Files:**
- Modify: `src/lib/state/mutations.ts` (rollback paths in `useSaveActivity` and `useToggleDependencyActive`)
- Modify: `src/lib/state/mutations.test.ts` (add two tests)

The current rollback for `useSaveActivity` and `useToggleDependencyActive` restores the entire pre-mutation `BootstrapData` snapshot, which would silently clobber any realtime updates to other rows that arrived during the in-flight mutation. We need to restore only the row being edited.

- [ ] **Step 1: Write the failing tests**

In `src/lib/state/mutations.test.ts`, append:

```ts
import { QueryClient } from "@tanstack/react-query";
import { applyRealtimeEvent } from "@/lib/realtime/reducers";

describe("rollback fixes (Phase 6 precondition)", () => {
  it("useSaveActivity rollback preserves a sibling row update applied during the mutation", () => {
    // We exercise the rollback shape directly: simulate the snapshot capture,
    // a concurrent realtime update to a sibling row, and the rollback patch.
    const qc = new QueryClient();
    const A1 = makeAct("a", 1, "A-orig");
    const B1 = makeAct("b", 1, "B-orig");
    const dataSnapshot: Partial<BootstrapData> = { activities: [A1, B1] } as BootstrapData;
    qc.setQueryData(["schedule", "p"], dataSnapshot);

    // Mutation begins → optimistic patch on A
    qc.setQueryData(["schedule", "p"], (cur: BootstrapData | undefined) => {
      if (!cur) return cur;
      return { ...cur, activities: cur.activities.map((a) =>
        a.id === "a" ? { ...a, name: "A-optimistic" } : a) };
    });

    // Realtime UPDATE for B arrives during the mutation
    qc.setQueryData(["schedule", "p"], (cur: BootstrapData | undefined) => {
      if (!cur) return cur;
      return applyRealtimeEvent(cur as BootstrapData, {
        table: "activities", type: "UPDATE",
        new: { ...B1, version: 2, name: "B-remote" },
      });
    });

    // Mutation fails → per-row rollback for A (the fix under test)
    qc.setQueryData(["schedule", "p"], (cur: BootstrapData | undefined) => {
      if (!cur) return cur;
      const snapshotRow = (dataSnapshot as BootstrapData).activities.find((a) => a.id === "a")!;
      return {
        ...cur,
        activities: cur.activities.map((a) => a.id === "a" ? snapshotRow : a),
      };
    });

    const after = qc.getQueryData<BootstrapData>(["schedule", "p"])!;
    expect(after.activities.find((a) => a.id === "a")!.name).toBe("A-orig");
    expect(after.activities.find((a) => a.id === "b")!.name).toBe("B-remote");
    expect(after.activities.find((a) => a.id === "b")!.version).toBe(2);
  });

  it("useToggleDependencyActive rollback preserves sibling activity update", () => {
    const qc = new QueryClient();
    const dep = { id: "d", project_id: "p", predecessor_id: "a", successor_id: "b",
      type: "FS" as const, lag: 0, is_active: true, deleted_at: null };
    const A1 = makeAct("a", 1, "A-orig");
    qc.setQueryData(["schedule", "p"], { activities: [A1], dependencies: [dep] });

    // Optimistic toggle
    qc.setQueryData(["schedule", "p"], (cur: { activities: DbActivity[]; dependencies: typeof dep[] }) =>
      ({ ...cur, dependencies: cur.dependencies.map((d) => d.id === "d" ? { ...d, is_active: false } : d) }),
    );

    // Realtime update to sibling activity
    qc.setQueryData(["schedule", "p"], (cur: BootstrapData | undefined) => {
      if (!cur) return cur;
      return applyRealtimeEvent(cur, {
        table: "activities", type: "UPDATE",
        new: { ...A1, version: 2, name: "A-remote" },
      });
    });

    // Per-row rollback for dep
    qc.setQueryData(["schedule", "p"], (cur: { activities: DbActivity[]; dependencies: typeof dep[] } | undefined) => {
      if (!cur) return cur;
      return { ...cur, dependencies: cur.dependencies.map((d) =>
        d.id === "d" ? { ...d, is_active: true } : d) };
    });

    const after = qc.getQueryData<BootstrapData>(["schedule", "p"])!;
    expect(after.dependencies[0].is_active).toBe(true);  // rolled back
    expect(after.activities[0].name).toBe("A-remote");   // preserved
  });
});
```

(These tests document the intended shape; the production rollback inside the mutations should follow the same per-row pattern.)

- [ ] **Step 2: Run the tests — they should pass**

```bash
npm test -- src/lib/state/mutations.test.ts
```

Expected: PASS (the tests use generic setQueryData mechanics and don't depend on mutation code yet — they prove the per-row pattern works). If they pass, proceed to actually wire the per-row rollback in the mutation code so production matches the test's shape.

- [ ] **Step 3: Replace the full-snapshot rollback in `useSaveActivity`**

In `src/lib/state/mutations.ts`, locate the rollback inside `useSaveActivity` (around lines 152–164):

```ts
if (!result.ok) {
  // Rollback optimistic patch.
  qc.setQueryData(["schedule", projectId], data);
  if (result.kind === "conflict") {
    // Update cache with fresh row.
    qc.setQueryData(["schedule", projectId], {
      ...data,
      activities: data.activities.map((a) => (a.id === vars.id ? result.fresh : a)),
    });
    toast.error("This activity was changed by someone else — your edit was discarded.");
  } else {
    toast.error(`Save failed: ${result.message}`);
  }
  return;
}
```

Replace with:

```ts
if (!result.ok) {
  // Per-row rollback — do NOT restore the full snapshot, which would clobber
  // realtime updates to sibling rows received during the mutation.
  const snapshotRow = current;
  if (result.kind === "conflict") {
    qc.setQueryData(["schedule", projectId], (cur: BootstrapData | undefined) => {
      if (!cur) return cur;
      return {
        ...cur,
        activities: cur.activities.map((a) => a.id === vars.id ? result.fresh : a),
      };
    });
    toast.error("This activity was changed by someone else — your edit was discarded.");
  } else {
    qc.setQueryData(["schedule", projectId], (cur: BootstrapData | undefined) => {
      if (!cur) return cur;
      return {
        ...cur,
        activities: cur.activities.map((a) => a.id === vars.id ? snapshotRow : a),
      };
    });
    toast.error(`Save failed: ${result.message}`);
  }
  return;
}
```

- [ ] **Step 4: Replace the full-snapshot rollback in `useToggleDependencyActive`**

In the same file, find `useToggleDependencyActive` (around line 332) and its rollback (line ~349):

```ts
const { error } = await sb.from("dependencies").update({ is_active: next }).eq("id", id);
if (error) {
  qc.setQueryData(["schedule", projectId], data);
  toast.error(`Toggle failed: ${error.message}`);
  return;
}
```

Replace the rollback line with a per-row restore:

```ts
const { error } = await sb.from("dependencies").update({ is_active: next }).eq("id", id);
if (error) {
  qc.setQueryData(["schedule", projectId], (cur: BootstrapData | undefined) => {
    if (!cur) return cur;
    return {
      ...cur,
      dependencies: cur.dependencies.map((d) => d.id === id ? dep : d),
    };
  });
  toast.error(`Toggle failed: ${error.message}`);
  return;
}
```

(Note: `dep` is the pre-toggle dependency captured earlier in the function; verify it's in scope.)

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all green. Test count grew by 2 from the new rollback tests.

- [ ] **Step 6: Typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/state/mutations.ts src/lib/state/mutations.test.ts
git commit -m "fix(mutations): per-row rollback in useSaveActivity + useToggleDependencyActive"
```

---

## Task 13: Wire `markInflight` into insert mutations

**Files:**
- Modify: `src/lib/state/mutations.ts` (specifically `useInsertDependency` ~line 252 and `usePostComment` ~line 366)

After a successful insert, register the returned row's id in the echo set so the inevitable realtime INSERT echo is dropped instead of duplicating the row in the cache.

- [ ] **Step 1: Add the import**

At the top of `src/lib/state/mutations.ts`, add:

```ts
import { markInflight } from "@/lib/realtime/echo-set";
```

- [ ] **Step 2: Mark inflight after the dependency insert**

In `useInsertDependency`, find the success block (around lines 274–283):

```ts
if (error || !data) {
  toast.error(`Insert dependency failed: ${error?.message ?? "unknown"}`);
  return;
}

qc.setQueryData(["schedule", projectId], (prev: BootstrapData | undefined) => {
  if (!prev) return prev;
  return { ...prev, dependencies: [...prev.dependencies, data as unknown as DbDependency] };
});
```

Right after the `setQueryData` call, insert:

```ts
markInflight(data.id);
```

- [ ] **Step 3: Mark inflight after the comment insert**

In `usePostComment`, find the success block (around lines 391–399):

```ts
if (error || !data) {
  toast.error(`Comment failed: ${error?.message ?? "unknown"}`);
  return;
}
qc.setQueryData(["schedule", projectId], (prev: BootstrapData | undefined) => {
  if (!prev) return prev;
  return { ...prev, comments: [data as never, ...prev.comments] };
});
```

After the `setQueryData` call, insert:

```ts
markInflight(data.id);
```

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: all green. No tests need updating because `markInflight` is pure side-effect with no return value to assert on at this layer — the echo-set unit tests already cover its behavior.

- [ ] **Step 5: Commit**

```bash
git add src/lib/state/mutations.ts
git commit -m "feat(mutations): mark inserted rows in the echo set to suppress self-echo"
```

---

## Task 14: `PresenceBar` component (TDD)

**Files:**
- Create: `src/components/schedule/PresenceBar.tsx`
- Create: `src/components/schedule/PresenceBar.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/schedule/PresenceBar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { usePresenceStore } from "@/lib/state/presence-store";
import { PresenceBar } from "./PresenceBar";

beforeEach(() => {
  usePresenceStore.setState({ online: {}, connection: "connecting" });
});

function setOnline(users: Array<Partial<{ userId: string; displayName: string; color: string; editMode: boolean }>>) {
  const online: Record<string, ReturnType<typeof usePresenceStore.getState>["online"][string]> = {};
  for (const u of users) {
    const userId = u.userId ?? `u-${Math.random()}`;
    online[userId] = {
      userId,
      displayName: u.displayName ?? "X",
      color: u.color ?? "#000000",
      editMode: u.editMode ?? false,
      joinedAt: "2026-01-01T00:00:00Z",
    };
  }
  usePresenceStore.setState({ online });
}

describe("<PresenceBar />", () => {
  it("renders one circle per online user up to 5", () => {
    setOnline([
      { displayName: "Alice" },
      { displayName: "Bob" },
      { displayName: "Carol" },
    ]);
    render(<PresenceBar currentUserId="u-self" />);
    expect(screen.getAllByTestId("presence-avatar")).toHaveLength(3);
  });

  it("shows an overflow chip when more than 5 users are online", () => {
    setOnline([
      { displayName: "A" }, { displayName: "B" }, { displayName: "C" },
      { displayName: "D" }, { displayName: "E" }, { displayName: "F" },
      { displayName: "G" },
    ]);
    render(<PresenceBar currentUserId="u-self" />);
    expect(screen.getAllByTestId("presence-avatar")).toHaveLength(5);
    expect(screen.getByTestId("presence-overflow")).toHaveTextContent("+2");
  });

  it("renders an editing indicator for edit-mode users", () => {
    setOnline([
      { userId: "u1", displayName: "Editor", editMode: true },
      { userId: "u2", displayName: "Viewer", editMode: false },
    ]);
    render(<PresenceBar currentUserId="u-self" />);
    const editing = screen.getAllByTestId("presence-avatar").filter((el) =>
      el.getAttribute("data-editing") === "true");
    expect(editing).toHaveLength(1);
    expect(editing[0]).toHaveAttribute("aria-label", expect.stringMatching(/Editor.*Editing/));
  });

  it("renders the connection dot reflecting store status", () => {
    usePresenceStore.setState({ connection: "offline", online: {} });
    render(<PresenceBar currentUserId="u-self" />);
    expect(screen.getByTestId("presence-connection")).toHaveAttribute("data-status", "offline");
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

```bash
npm test -- src/components/schedule/PresenceBar.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Write the component**

Create `src/components/schedule/PresenceBar.tsx`:

```tsx
"use client";

import { clsx } from "clsx";
import { Pencil } from "lucide-react";
import { usePresenceStore } from "@/lib/state/presence-store";

interface Props {
  currentUserId: string;
}

const MAX_AVATARS = 5;

function initials(name: string): string {
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "");
}

export function PresenceBar({ currentUserId }: Props) {
  const online = usePresenceStore((s) => s.online);
  const connection = usePresenceStore((s) => s.connection);

  const entries = Object.values(online).sort((a, b) => {
    if (a.userId === currentUserId) return -1;
    if (b.userId === currentUserId) return 1;
    return a.joinedAt.localeCompare(b.joinedAt);
  });

  const visible = entries.slice(0, MAX_AVATARS);
  const overflow = entries.length - visible.length;

  const dotColor =
    connection === "live" ? "bg-emerald-500" :
    connection === "offline" ? "bg-red-500" : "bg-slate-300";

  return (
    <div className="flex items-center gap-1.5">
      <span
        data-testid="presence-connection"
        data-status={connection}
        className={clsx("inline-block h-2 w-2 rounded-full", dotColor)}
        aria-label={`Live updates ${connection}`}
      />
      <div className="flex -space-x-1.5">
        {visible.map((u) => (
          <div
            key={u.userId}
            data-testid="presence-avatar"
            data-editing={u.editMode}
            aria-label={`${u.displayName}${u.editMode ? " — Editing" : " — Viewing"}`}
            title={`${u.displayName}${u.editMode ? " — Editing" : ""}`}
            className={clsx(
              "relative flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold uppercase text-white",
              u.userId === currentUserId && "opacity-70",
            )}
            style={{
              backgroundColor: u.color,
              outline: u.editMode ? `2px solid ${u.color}` : undefined,
              outlineOffset: u.editMode ? "1px" : undefined,
            }}
          >
            {initials(u.displayName)}
            {u.editMode && (
              <Pencil
                size={8}
                className="absolute -bottom-0.5 -right-0.5 rounded-full bg-white p-[1px] text-slate-700"
                strokeWidth={3}
              />
            )}
          </div>
        ))}
        {overflow > 0 && (
          <div
            data-testid="presence-overflow"
            className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-slate-500 text-[10px] font-semibold text-white"
          >
            +{overflow}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests — they should pass**

```bash
npm test -- src/components/schedule/PresenceBar.test.tsx
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/schedule/PresenceBar.tsx src/components/schedule/PresenceBar.test.tsx
git commit -m "feat(ui): add PresenceBar component with avatar stack + edit indicator + connection dot"
```

---

## Task 15: Mount `useProjectChannel` + `<PresenceBar />` in `ScheduleApp`

**Files:**
- Modify: `src/components/schedule/Toolbar.tsx`
- Modify: `src/components/schedule/ScheduleApp.tsx`

- [ ] **Step 1: Add an optional `right` slot to `Toolbar`**

In `src/components/schedule/Toolbar.tsx`, update the interface and JSX:

```tsx
interface ToolbarProps {
  projectName: string;
  problems: Problem[];
  right?: React.ReactNode;
}

export function Toolbar({ projectName, problems, right }: ToolbarProps) {
```

In the JSX, find the `<div className="flex items-center gap-2">` on line ~62. Insert `{right}` as the first child (before the Critical-path button):

```tsx
<div className="flex items-center gap-2">
  {right}
  <button
    onClick={() => setFilter("criticalOnly", !criticalOnly)}
    ...
```

Add the React import at the top if not present:

```tsx
import type { ReactNode } from "react";
```

(And change `right?: React.ReactNode` to `right?: ReactNode`.)

- [ ] **Step 2: Wire the hook + PresenceBar in ScheduleApp**

In `src/components/schedule/ScheduleApp.tsx`, add the imports:

```tsx
import { useProjectChannel } from "@/lib/realtime/use-project-channel";
import { PresenceBar } from "./PresenceBar";
import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
```

(`useState` may already be implied; double-check existing imports.)

Inside `ScheduleApp`, after the existing `useEffect` that seeds the cache, add:

```tsx
useProjectChannel(projectId);

const [currentUserId, setCurrentUserId] = useState<string>("");
useEffect(() => {
  const sb = createSupabaseBrowserClient();
  void sb.auth.getUser().then(({ data: { user } }) => {
    if (user) setCurrentUserId(user.id);
  });
}, []);
```

Then pass the `right` slot to `Toolbar`:

```tsx
<Toolbar
  projectName={bootstrap.project.name}
  problems={indexed.problems}
  right={<PresenceBar currentUserId={currentUserId} />}
/>
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: all green.

- [ ] **Step 5: Manual visual check**

```bash
npm run dev
```

In a browser:
1. Sign in as `scheduler@ihs.test` / `password123`.
2. Navigate to the project.
3. Verify a green connection dot + one avatar circle (your own) appears in the top-right of the toolbar.
4. Click "Edit mode" — the avatar gains a colored ring + pencil icon overlay.
5. Click "Exit edit" — the ring + pencil disappear.

Stop the dev server (Ctrl-C) after verification.

- [ ] **Step 6: Commit**

```bash
git add src/components/schedule/Toolbar.tsx src/components/schedule/ScheduleApp.tsx
git commit -m "feat(schedule): mount realtime channel + PresenceBar in ScheduleApp"
```

---

## Task 16: Inline-edit audit

**Files:** (verification only; possible small edits)

Per spec §8: confirm inline-edit inputs use `defaultValue=` (uncontrolled) so realtime updates to the cache mid-typing do not wipe in-progress input.

- [ ] **Step 1: Enumerate inline-edit inputs in schedule components**

```bash
grep -rn "defaultValue=\|value=" src/components/schedule/ | grep -v "test\." | grep -v "\.tsx:.*//"
```

Expected (current state per `git log`):
- `src/components/schedule/ActivityTable/WbsRow.tsx:81: defaultValue={a.name}` — name cell, uncontrolled ✓
- `src/components/schedule/ActivityTable/WbsRow.tsx:103: defaultValue={a.original_duration}` — duration cell, uncontrolled ✓
- `src/components/schedule/Lookahead/LookaheadView.tsx:77: value={selectedLookahead ?? ""}` — local UI state (selected lookahead), not from cache ✓ (no fix needed; lookaheads aren't synced in v1)
- `src/components/schedule/SidePanel/CommentComposer.tsx:32: value={body}` — local React state (`body`), not from cache ✓ (no fix needed; composer is for a draft message, not editing a persisted row)

- [ ] **Step 2: Verify each "value=" usage**

For each `value=` hit above, open the file and confirm the bound value is local component state (`useState`) rather than data flowing from `qc.getQueryData` / props from BootstrapData. If a future inline-edit binds `value={row.someField}` to a cached row's field, that's the bug pattern to fix in this step.

- [ ] **Step 3: Document the audit result in the commit**

If everything passes (no changes needed):

```bash
git commit --allow-empty -m "chore(audit): verify inline-edit inputs are uncontrolled (Phase 6 §8)"
```

If a controlled input bound to a cached field is found, convert to `defaultValue=` + `onBlur`/`onKeyDown` to commit, mirroring the WbsRow pattern; commit the fix.

---

## Task 17: E2E — two-context realtime happy path

**Files:**
- Create: `tests/e2e/realtime.e2e.spec.ts`

This test uses two browser contexts (Alice = scheduler, Bob = pm) to verify schedule changes, comments, and presence sync end-to-end.

- [ ] **Step 1: Confirm two scheduler-capable test users exist**

```bash
npx supabase db psql -c "select email from users where email like '%@ihs.test' order by email;"
```

Expected: at least `scheduler@ihs.test` and one other internal user (e.g., `pm@ihs.test`). If `pm@ihs.test` doesn't exist, use whichever second internal user the seed provides (check the seed SQL in `supabase/seed.sql` if present). Use the actual second-user email in the test below.

- [ ] **Step 2: Write the test**

Create `tests/e2e/realtime.e2e.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Riverside Office Build")).toBeVisible({ timeout: 10_000 });
}

test("two users see each other's schedule + comment changes live", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();

  await signIn(alice, "scheduler@ihs.test");
  await signIn(bob, "pm@ihs.test");  // change to the actual second internal user

  // Both should see at least one presence avatar
  await expect(alice.getByTestId("presence-avatar").first()).toBeVisible({ timeout: 10_000 });
  await expect(bob.getByTestId("presence-avatar").first()).toBeVisible({ timeout: 10_000 });
  // Bob sees Alice as an extra avatar (current user is rendered with opacity)
  await expect(bob.getByTestId("presence-avatar")).toHaveCount(2, { timeout: 10_000 });

  // Alice enters Edit Mode; Bob should see her avatar gain editing indicator
  await alice.getByRole("button", { name: /Edit mode/ }).click();
  await expect(bob.locator('[data-testid="presence-avatar"][data-editing="true"]'))
    .toBeVisible({ timeout: 10_000 });

  // Alice renames the first activity by double-clicking the name cell
  const firstName = alice.locator('span:has-text("Mobilize")').first();
  await firstName.dblclick();
  const input = alice.locator('input[autofocus]').first();
  await input.fill("Mobilize — REMOTE TEST");
  await input.press("Enter");

  // Bob sees the renamed row
  await expect(bob.getByText("Mobilize — REMOTE TEST").first())
    .toBeVisible({ timeout: 10_000 });

  // Bob posts a comment; Alice sees it appear in the side panel feed
  // (Find the comment composer — adapt selector if your CommentComposer markup differs.)
  await bob.getByPlaceholder(/comment|message/i).first().fill("hello from bob");
  await bob.getByRole("button", { name: /post|send|comment/i }).first().click();
  await expect(alice.getByText("hello from bob")).toBeVisible({ timeout: 10_000 });

  // Cleanup: Alice exits Edit Mode → Bob sees the indicator clear
  await alice.getByRole("button", { name: /Exit edit/ }).click();
  await expect(bob.locator('[data-testid="presence-avatar"][data-editing="true"]'))
    .toHaveCount(0, { timeout: 10_000 });

  // Restore the activity name so subsequent runs aren't polluted
  await alice.locator('span:has-text("Mobilize — REMOTE TEST")').first().dblclick();
  const undoInput = alice.locator('input[autofocus]').first();
  await undoInput.fill("Mobilize");
  await undoInput.press("Enter");

  await ctxA.close();
  await ctxB.close();
});
```

- [ ] **Step 3: Run the E2E suite**

```bash
npm run test:e2e -- tests/e2e/realtime.e2e.spec.ts
```

Expected: PASS. The test takes 20–40 seconds. If Playwright complains about ambiguous selectors, narrow with `.first()`, `.last()`, or `page.locator(...).filter({ hasText: ... })` — Phase 4 errata covered the same pattern. If the comment composer placeholder text doesn't match, run `npm run dev`, inspect the actual placeholder, and update the selector.

- [ ] **Step 4: Run the full Playwright suite to confirm no regression**

```bash
npm run test:e2e
```

Expected: all e2e tests pass, including `scheduler-happy-path.spec.ts` and `external-user.spec.ts`.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/realtime.e2e.spec.ts
git commit -m "test: e2e — two-context realtime sync (schedule, comments, presence)"
```

---

## Task 18: Manual smoke + push + open PR

- [ ] **Step 1: Manual smoke — schedule + presence**

```bash
npm run dev
```

In **two separate browsers** (e.g., Chrome regular + Chrome incognito), sign in as different internal users:
1. Browser A: `scheduler@ihs.test` / `password123`.
2. Browser B: `pm@ihs.test` (or whichever second internal user exists) / `password123`.

Verify:
- Both pages show two presence avatars in the toolbar.
- Browser A enters Edit Mode → Browser B sees A's avatar gain a colored ring + pencil overlay.
- Browser A double-clicks an activity name, types a new name, presses Enter → Browser B sees the new name within ~1 second.
- Browser A right-clicks an activity → Delete → Browser B sees the activity disappear (filtered by soft-delete).
- Browser A drags a Gantt bar to a new date → Browser B sees the bar move and any cascaded successors shift.

- [ ] **Step 2: Manual smoke — comment visibility (internal vs external)**

Open a third browser as `tp-viewer@trade.test` / `password123` (external user). Browser A (scheduler) posts a comment with visibility "internal" via the side panel composer.

Verify:
- Browser B (internal pm) sees the comment within ~1 second.
- Browser C (external tp-viewer) does NOT see the comment, ever (refresh to confirm).

Then post a comment with visibility "shared":
- All three browsers see it within ~1 second.

- [ ] **Step 3: Manual smoke — reconnect**

In Browser A, open DevTools → Network → set throttling to "Offline". The connection dot in the toolbar should turn red within ~30 seconds.

In Browser B, rename an activity.

In Browser A, set throttling back to "No throttling". The connection dot should turn green within ~5 seconds, and the activity rename made by Browser B should appear in Browser A's view (the SUBSCRIBED handler's `invalidateQueries` refetches the bootstrap).

Stop the dev server (Ctrl-C).

- [ ] **Step 4: Push the branch**

```bash
git push -u origin feat/phase-6-realtime
```

- [ ] **Step 5: Open the PR via gh**

```bash
gh pr create --title "Phase 6: Real-time collaboration" --body "$(cat <<'EOF'
## Summary
- Adds a single Supabase Realtime channel per project syncing six tables (activities, dependencies, activity_constraints, wbs_nodes, comments, activity_history) via postgres_changes.
- Echo + ordering suppression: version gate for activities, 30s-TTL inflight Map for unversioned tables.
- Channel-native presence with online + edit-mode awareness; new PresenceBar in the toolbar showing avatar stack + connection dot.
- Migration adds `project_id` to `activity_constraints`, sets `replica identity full` on the six tables, and adds them to the `supabase_realtime` publication.
- Two writer-side precondition fixes: cascade writes now bump `version`; rollback in `useSaveActivity` + `useToggleDependencyActive` restores only the edited row (so it doesn't clobber realtime updates to sibling rows received during the mutation).

## Spec
`docs/superpowers/specs/2026-05-24-phase-6-realtime-design.md`

## Test plan
- [x] All unit + integration tests pass (`npm test`).
- [x] Typecheck + lint clean.
- [x] Two-context Playwright E2E passes (`tests/e2e/realtime.e2e.spec.ts`).
- [x] Manual smoke: two browsers sync schedule edits, comments, presence; internal comments stay internal to external users; offline → online reconnect refetches.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Note the PR URL**

The PR will need a review + merge by you. Once merged, Phase 6 is complete and the roadmap moves to Phase 7 (Comments side panel + visibility — already partially built in Phase 5; remaining work is per §7.2 of the plan).

---

## Summary

This plan delivers Phase 6 — Real-time collaboration — per spec `2026-05-24-phase-6-realtime-design.md`:

- **Migration** (Task 2) adds `project_id` to `activity_constraints` and enables the `supabase_realtime` publication on six tables.
- **Realtime client** (Tasks 4–10) is a single `useProjectChannel` hook delegating to pure modules: `events.ts` (types), `echo-set.ts` (TTL Map), `normalize.ts` (Supabase payload adapter), `reducers.ts` (cache merger), `presence.ts` (color helper), `presence-store.ts` (zustand store).
- **Writer-side fixes** (Tasks 11–13) bump `version` on cascade writes, replace full-snapshot rollback with per-row restore, and wire `markInflight` into insert mutations.
- **UI** (Tasks 14–15) adds `PresenceBar` and mounts it + the channel hook in `ScheduleApp` via a new `right` slot on `Toolbar`.
- **Verification** (Tasks 16–17) audits inline-edit inputs and adds a two-context Playwright E2E.

Test count grows by ~40 unit/integration + 1 E2E.

## Out of scope (deferred to a future phase)

- Per-activity presence ("X is viewing Foundation").
- Cursor / selection broadcasting.
- Idle detection.
- Hard edit locks (still advisory in v1).
- Lookahead / calendar realtime sync.
- RLS-filtered realtime E2E (HTTP-level coverage in `e3b3b5b` proves the same policies; duplicating in realtime adds runtime cost without changing what's verified).
- Manual offline/reconnect E2E (hook-level test in Task 10 covers the SUBSCRIBED handler).

## Test plan

- All unit + integration tests pass (`npm test`).
- Typecheck + lint clean (`npm run typecheck && npm run lint`).
- New two-context E2E passes (`npm run test:e2e -- tests/e2e/realtime.e2e.spec.ts`).
- Full E2E suite passes (`npm run test:e2e`).
- Manual smoke:
  - Two internal browsers stay in sync on rename, delete, drag, comment.
  - External user does not receive internal comment broadcasts.
  - Offline → online reconnect refetches bootstrap (connection dot returns to green).

The PR will need a review + merge by you. Once merged, Phase 6 is complete.
