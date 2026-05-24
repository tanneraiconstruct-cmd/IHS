# Section 5 — Lookahead Module, Field-Usable v1 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Lookahead module field-usable: create a lookahead via a modal, auto-populate it with master activities in the window, and add/edit/delete tasks (master-linked or detached) with inline cell editing. The read-only LookaheadView from Phase 4 T17 is extended in place; no schema changes.

**Architecture:** Six new TanStack Query mutation hooks added to `src/lib/state/mutations.ts` following the Phase 4 pattern (optimistic update → rollback on error → toast). All writes go through `@supabase/supabase-js` under RLS; no new server actions, no new Postgres functions, no migrations. Render-time offset resolution is unchanged from Phase 4. The `LookaheadView` component is replaced with a wired-up version; two new components (`NewLookaheadModal`, `LookaheadTaskRow`) are added.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, `@supabase/supabase-js`, `@tanstack/react-query`, `zustand`, Tailwind v4, Vitest + React Testing Library + `jsdom`, Playwright.

**Source spec:** `docs/superpowers/specs/2026-05-23-section-5-lookahead-design.md`

---

## Conventions & Working Notes

- **Branch:** all work happens on `feat/section-5-lookahead` (created in Task 1 from `origin/main`).
- **TDD:** every non-trivial code task starts with a failing test. The plan shows the test code; do not skip to implementation. For pure logic the test is Vitest with `node` environment; for React components it's Vitest with `jsdom` (already configured in `vitest.config.ts`).
- **Frequent commits:** every task ends with a commit step. Don't batch commits across tasks. If a task balloons mid-implementation, split it.
- **No version checks.** `lookahead_tasks` has no `version` column. All writes are plain `update().eq('id', id)` — last-write-wins. This matches the Phase 4 cascade-write posture; see the spec §3.4.
- **No history rows.** Lookahead-task edits do NOT write to `activity_history`. The spec §6.4 calls this out.
- **Toast on error.** Every mutation's `onError` (or the inline error branch inside `mutationFn`) calls `toast.error("…")` from `@/lib/state/toasts`. The Phase 4 pattern uses an inline error branch inside `mutationFn` rather than the `onError` callback — this plan follows the same pattern for consistency.
- **Hardcoded constants for v1:**
  - Project ID: `70000000-0000-0000-0000-000000000000` (seeded Riverside Office Build).
  - Test users (password `password123`):
    - `scheduler@ihs.test` — internal scheduler role, full edit access.
    - `tp-viewer@trade.test` — external trade-partner viewer, read-only.
- **Phase 4 references** (read these before starting):
  - `src/lib/state/mutations.ts` — the canonical mutation-hook patterns. Copy the shape exactly.
  - `src/components/schedule/ActivityTable/WbsRow.tsx` — the canonical inline-edit pattern: `useState<"name"|"duration"|null>` for which cell is in edit mode, `defaultValue` + `onBlur` + `onKeyDown` (Enter blurs, Escape cancels), `autoFocus` on the input.
  - `src/components/schedule/ContextMenu.tsx` — close-on-outside-click pattern that the modal will adapt.
  - `tests/e2e/scheduler-happy-path.spec.ts` — the Playwright authentication + view-switch pattern.

---

## File Structure

### To create

| File | Responsibility |
|---|---|
| `src/lib/state/auto-populate.ts` | Pure `mastersInWindow(bootstrap, indexed, windowStart, windowEnd)` selector. |
| `src/lib/state/auto-populate.test.ts` | Boundary tests for `mastersInWindow`. |
| `src/lib/state/mutations.lookahead.test.ts` | Tests for the 6 lookahead mutation hooks (covered via their pure helpers). |
| `src/components/schedule/Lookahead/NewLookaheadModal.tsx` | Modal form: name, window dates, optional type. |
| `src/components/schedule/Lookahead/NewLookaheadModal.test.tsx` | Form validation + submit-args test. |
| `src/components/schedule/Lookahead/LookaheadTaskRow.tsx` | One row of the lookahead table with inline cell edits. |
| `src/components/schedule/Lookahead/LookaheadTaskRow.test.tsx` | Click-to-edit, Enter/Esc/blur behavior, offset-vs-detached cell visibility. |
| `src/components/schedule/Lookahead/LookaheadView.test.tsx` | Component-integration: renders bootstrap with masters + lookahead + tasks. |
| `tests/e2e/lookahead-flow.spec.ts` | Playwright happy-path. |

### To modify

| File | Change |
|---|---|
| `src/components/schedule/Lookahead/LookaheadView.tsx` | Replace contents: add "+ New Lookahead" button + modal mount, "+ Add Task" footer button, per-row Delete, empty-tasks "Re-populate from master" recovery. Use `LookaheadTaskRow` for each row. |
| `src/lib/state/mutations.ts` | Append six new hooks: `useCreateLookahead`, `useUpdateLookahead`, `useDeleteLookahead`, `useInsertLookaheadTask`, `useUpdateLookaheadTask`, `useDeleteLookaheadTask`. Also add three pure helpers: `applyOptimisticLookaheadPatch`, `applyOptimisticLookaheadTaskPatch`, `softDeleteFromCache`. |

### Unchanged

- All Phase 2 migrations and RLS.
- All Phase 4 engine, bootstrap, recalc, toast, query, ui-store, and non-lookahead component files.
- All Phase 3 server pipeline (still dormant).

---

## Task 1: Branch + plumbing check

**Files:**
- None to create/modify.

- [ ] **Step 1: Create the implementation branch from origin/main**

```bash
cd "/Users/tanner/IHS- Scheduling Tool"
git fetch origin
git checkout -b feat/section-5-lookahead origin/main
git status
```

Expected: `On branch feat/section-5-lookahead. Your branch is up to date with 'origin/main'. nothing to commit, working tree clean.`

- [ ] **Step 2: Verify the baseline still builds**

```bash
npm install
npm run lint && npm run typecheck && npm run build
```

Expected: all three succeed. (No new dependencies needed for Section 5 — everything reuses Phase 4's stack.)

- [ ] **Step 3: Verify the existing test suite passes**

```bash
npm test
```

Expected: 154 tests pass (24 files). This is the Phase 4 baseline.

- [ ] **Step 4: No commit needed.** Branch is set up; nothing has changed yet.

---

## Task 2: Pure `mastersInWindow` selector (TDD)

**Files:**
- Create: `src/lib/state/auto-populate.ts`
- Create: `src/lib/state/auto-populate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/state/auto-populate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mastersInWindow } from "./auto-populate";
import type { BootstrapData, IndexedResult, DbActivity } from "@/lib/schedule/types";
import type { ScheduleResult } from "@/lib/schedule-engine";

function act(over: Partial<DbActivity> = {}): DbActivity {
  return {
    id: over.id ?? "a", project_id: "p", wbs_node_id: null, name: "A",
    activity_type: "task", original_duration: 1, remaining_duration: 1,
    calendar_id: null, actual_start: null, actual_finish: null,
    percent_complete: 0, responsible_company_id: null,
    early_start: null, early_finish: null, late_start: null, late_finish: null,
    planned_start: null, planned_finish: null, total_float: null, free_float: null,
    is_critical: false, version: 1, deleted_at: null, ...over,
  };
}

function indexed(...rows: { id: string; plannedStart: string; plannedFinish: string }[]): IndexedResult {
  const byActivity = new Map<string, ScheduleResult["activities"][number]>();
  for (const r of rows) {
    byActivity.set(r.id, {
      id: r.id,
      earlyStart: r.plannedStart, earlyFinish: r.plannedFinish,
      lateStart: r.plannedStart, lateFinish: r.plannedFinish,
      plannedStart: r.plannedStart, plannedFinish: r.plannedFinish,
      totalFloat: 0, freeFloat: 0, isCritical: false,
    });
  }
  return { byActivity, projectFinish: null, problems: [] };
}

function bs(activities: DbActivity[]): BootstrapData {
  return {
    project: { id: "p", name: "P", number: null, project_start: "2026-05-01",
      data_date: null, default_calendar_id: "c", critical_float_threshold: 0,
      comment_visibility_default: "internal" },
    calendars: [], calendarExceptions: [], wbsNodes: [],
    activities, dependencies: [], constraints: [], comments: [], history: [],
    lookaheads: [], lookaheadTasks: [],
  };
}

describe("mastersInWindow", () => {
  it("includes a master that starts before window and ends inside", () => {
    const b = bs([act({ id: "a" })]);
    const r = mastersInWindow(b, indexed({ id: "a", plannedStart: "2026-05-01", plannedFinish: "2026-05-10" }),
      "2026-05-05", "2026-05-15");
    expect(r.map((x) => x.id)).toEqual(["a"]);
  });

  it("includes a master fully inside the window", () => {
    const b = bs([act({ id: "a" })]);
    const r = mastersInWindow(b, indexed({ id: "a", plannedStart: "2026-05-06", plannedFinish: "2026-05-10" }),
      "2026-05-05", "2026-05-15");
    expect(r.map((x) => x.id)).toEqual(["a"]);
  });

  it("excludes a master fully before the window", () => {
    const b = bs([act({ id: "a" })]);
    const r = mastersInWindow(b, indexed({ id: "a", plannedStart: "2026-05-01", plannedFinish: "2026-05-04" }),
      "2026-05-05", "2026-05-15");
    expect(r).toHaveLength(0);
  });

  it("excludes a master fully after the window", () => {
    const b = bs([act({ id: "a" })]);
    const r = mastersInWindow(b, indexed({ id: "a", plannedStart: "2026-05-20", plannedFinish: "2026-05-25" }),
      "2026-05-05", "2026-05-15");
    expect(r).toHaveLength(0);
  });

  it("excludes summary and level_of_effort activities", () => {
    const b = bs([act({ id: "a", activity_type: "summary" }), act({ id: "b", activity_type: "level_of_effort" })]);
    const r = mastersInWindow(b,
      indexed({ id: "a", plannedStart: "2026-05-06", plannedFinish: "2026-05-10" },
              { id: "b", plannedStart: "2026-05-06", plannedFinish: "2026-05-10" }),
      "2026-05-05", "2026-05-15");
    expect(r).toHaveLength(0);
  });

  it("excludes soft-deleted activities", () => {
    const b = bs([act({ id: "a", deleted_at: "2026-05-01T00:00:00Z" })]);
    const r = mastersInWindow(b, indexed({ id: "a", plannedStart: "2026-05-06", plannedFinish: "2026-05-10" }),
      "2026-05-05", "2026-05-15");
    expect(r).toHaveLength(0);
  });

  it("excludes activities with no engine result", () => {
    const b = bs([act({ id: "a" })]);
    const r = mastersInWindow(b, indexed(), "2026-05-05", "2026-05-15");
    expect(r).toHaveLength(0);
  });

  it("includes milestones (single-day) at the window boundary", () => {
    const b = bs([act({ id: "m", activity_type: "milestone", original_duration: 0, remaining_duration: 0 })]);
    const r = mastersInWindow(b, indexed({ id: "m", plannedStart: "2026-05-15", plannedFinish: "2026-05-15" }),
      "2026-05-05", "2026-05-15");
    expect(r.map((x) => x.id)).toEqual(["m"]);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test -- src/lib/state/auto-populate.test.ts
```

Expected: FAIL with `Failed to load url ./auto-populate` or similar (module does not exist).

- [ ] **Step 3: Implement the selector**

Create `src/lib/state/auto-populate.ts`:

```ts
import type { BootstrapData, DbActivity, IndexedResult } from "@/lib/schedule/types";

/**
 * Master activities (tasks + milestones, not deleted) whose engine-computed
 * planned dates intersect the window [windowStart, windowEnd] inclusive.
 * Activities without an engine result are excluded.
 */
export function mastersInWindow(
  data: BootstrapData,
  indexed: IndexedResult,
  windowStart: string,
  windowEnd: string,
): DbActivity[] {
  return data.activities.filter((a) => {
    if (a.deleted_at !== null) return false;
    if (a.activity_type !== "task" && a.activity_type !== "milestone") return false;
    const r = indexed.byActivity.get(a.id);
    if (!r) return false;
    return r.plannedStart <= windowEnd && r.plannedFinish >= windowStart;
  });
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm test -- src/lib/state/auto-populate.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/state/auto-populate.ts src/lib/state/auto-populate.test.ts
git commit -m "$(cat <<'EOF'
feat: add pure mastersInWindow selector for lookahead auto-populate

Returns task + milestone master activities whose engine-computed planned
dates intersect a date window. Filters deleted, summary/LOE, and
activities without engine results. Boundary inclusive on both ends.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Pure mutation helpers + mutation tests scaffolding

**Files:**
- Modify: `src/lib/state/mutations.ts`
- Create: `src/lib/state/mutations.lookahead.test.ts`

This task adds the pure cache-patch helpers used by the six mutation hooks in tasks 4 and 5. The hooks themselves are wired in those tasks. This split lets the pure logic be unit-tested cleanly.

- [ ] **Step 1: Write the failing test**

Create `src/lib/state/mutations.lookahead.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  applyOptimisticLookaheadPatch,
  applyOptimisticLookaheadTaskPatch,
  softDeleteFromCache,
} from "./mutations";
import type { BootstrapData, DbLookahead, DbLookaheadTask } from "@/lib/schedule/types";

function lookahead(over: Partial<DbLookahead> = {}): DbLookahead {
  return {
    id: over.id ?? "L1", project_id: "p", name: "L1",
    window_start: "2026-05-01", window_end: "2026-05-28",
    type: null, source_mode: "from_master", deleted_at: null, ...over,
  };
}

function task(over: Partial<DbLookaheadTask> = {}): DbLookaheadTask {
  return {
    id: over.id ?? "T1", lookahead_id: "L1", master_activity_id: null, name: "T1",
    offset_start: null, offset_finish: null, start_date: null, finish_date: null,
    crew: null, responsible_company_id: null, status: null,
    percent_complete: 0, constraints_cleared: false, readiness_notes: null,
    deleted_at: null, ...over,
  };
}

function makeData(over: Partial<BootstrapData> = {}): BootstrapData {
  return {
    project: { id: "p", name: "P", number: null, project_start: "2026-05-01",
      data_date: null, default_calendar_id: "c", critical_float_threshold: 0,
      comment_visibility_default: "internal" },
    calendars: [], calendarExceptions: [], wbsNodes: [],
    activities: [], dependencies: [], constraints: [],
    comments: [], history: [],
    lookaheads: [lookahead()],
    lookaheadTasks: [task()],
    ...over,
  };
}

describe("applyOptimisticLookaheadPatch", () => {
  it("merges a patch into the target lookahead and leaves others alone", () => {
    const data = makeData({ lookaheads: [lookahead({ id: "L1" }), lookahead({ id: "L2" })] });
    const next = applyOptimisticLookaheadPatch(data, "L1", { name: "Renamed" });
    expect(next.lookaheads.find((l) => l.id === "L1")?.name).toBe("Renamed");
    expect(next.lookaheads.find((l) => l.id === "L2")?.name).toBe("L1");
  });
});

describe("applyOptimisticLookaheadTaskPatch", () => {
  it("merges a patch into the target task and leaves others alone", () => {
    const data = makeData({ lookaheadTasks: [task({ id: "T1" }), task({ id: "T2" })] });
    const next = applyOptimisticLookaheadTaskPatch(data, "T1", { percent_complete: 50 });
    expect(next.lookaheadTasks.find((t) => t.id === "T1")?.percent_complete).toBe(50);
    expect(next.lookaheadTasks.find((t) => t.id === "T2")?.percent_complete).toBe(0);
  });
});

describe("softDeleteFromCache", () => {
  it("soft-deletes a lookahead by id", () => {
    const data = makeData();
    const next = softDeleteFromCache(data, "lookahead", "L1", "2026-05-23T00:00:00Z");
    expect(next.lookaheads[0].deleted_at).toBe("2026-05-23T00:00:00Z");
  });

  it("soft-deletes a lookahead_task by id", () => {
    const data = makeData();
    const next = softDeleteFromCache(data, "lookaheadTask", "T1", "2026-05-23T00:00:00Z");
    expect(next.lookaheadTasks[0].deleted_at).toBe("2026-05-23T00:00:00Z");
  });

  it("leaves unrelated rows alone", () => {
    const data = makeData({
      lookaheads: [lookahead({ id: "L1" }), lookahead({ id: "L2" })],
    });
    const next = softDeleteFromCache(data, "lookahead", "L1", "2026-05-23T00:00:00Z");
    expect(next.lookaheads.find((l) => l.id === "L1")?.deleted_at).toBe("2026-05-23T00:00:00Z");
    expect(next.lookaheads.find((l) => l.id === "L2")?.deleted_at).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test -- src/lib/state/mutations.lookahead.test.ts
```

Expected: FAIL — the three helper exports don't exist yet.

- [ ] **Step 3: Add the helpers to `src/lib/state/mutations.ts`**

Open `src/lib/state/mutations.ts` and add these helpers AFTER the existing `applyOptimisticDependencyPatch` function (before the `PersistResult` type definition). Also extend the existing import line to bring in the lookahead types.

Replace the existing import block at the top of the file:

```ts
import type {
  BootstrapData, DbActivity, DbActivityHistory, DbDependency,
} from "@/lib/schedule/types";
```

with:

```ts
import type {
  BootstrapData, DbActivity, DbActivityHistory, DbDependency,
  DbLookahead, DbLookaheadTask,
} from "@/lib/schedule/types";
```

Then add these three exported functions immediately after `applyOptimisticDependencyPatch`:

```ts
export function applyOptimisticLookaheadPatch(
  data: BootstrapData,
  id: string,
  patch: Partial<DbLookahead>,
): BootstrapData {
  return {
    ...data,
    lookaheads: data.lookaheads.map((l) =>
      l.id === id ? { ...l, ...patch } : l,
    ),
  };
}

export function applyOptimisticLookaheadTaskPatch(
  data: BootstrapData,
  id: string,
  patch: Partial<DbLookaheadTask>,
): BootstrapData {
  return {
    ...data,
    lookaheadTasks: data.lookaheadTasks.map((t) =>
      t.id === id ? { ...t, ...patch } : t,
    ),
  };
}

export function softDeleteFromCache(
  data: BootstrapData,
  kind: "lookahead" | "lookaheadTask",
  id: string,
  deletedAt: string,
): BootstrapData {
  if (kind === "lookahead") {
    return {
      ...data,
      lookaheads: data.lookaheads.map((l) =>
        l.id === id ? { ...l, deleted_at: deletedAt } : l,
      ),
    };
  }
  return {
    ...data,
    lookaheadTasks: data.lookaheadTasks.map((t) =>
      t.id === id ? { ...t, deleted_at: deletedAt } : t,
    ),
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm test -- src/lib/state/mutations.lookahead.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Verify the full suite still passes**

```bash
npm test
```

Expected: existing 154 + new 8 (Task 2) + new 5 (Task 3) = 167 tests pass (or thereabouts).

- [ ] **Step 6: Commit**

```bash
git add src/lib/state/mutations.ts src/lib/state/mutations.lookahead.test.ts
git commit -m "$(cat <<'EOF'
feat: add lookahead cache-patch helpers for upcoming mutation hooks

Adds applyOptimisticLookaheadPatch, applyOptimisticLookaheadTaskPatch,
and softDeleteFromCache. Pure functions over BootstrapData, used by the
six lookahead mutation hooks added next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Lookahead-level mutation hooks (create, update, delete)

**Files:**
- Modify: `src/lib/state/mutations.ts`

The `useCreateLookahead` hook is the one with the auto-populate logic (calls `mastersInWindow`, does two inserts in sequence). Update and delete are trivial single-table writes.

- [ ] **Step 1: Append the three hooks to `src/lib/state/mutations.ts`**

Add the following block at the END of the file (after `usePostComment`):

```ts
// --- Lookahead-level mutations ------------------------------------------

const LOOKAHEAD_SELECT =
  "id, project_id, name, window_start, window_end, type, source_mode, deleted_at";

export function useCreateLookahead(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["createLookahead", projectId],
    mutationFn: async (vars: {
      name: string;
      windowStart: string;
      windowEnd: string;
      type: string | null;
    }): Promise<{ lookaheadId: string; taskCount: number }> => {
      const sb = createSupabaseBrowserClient();
      const data = qc.getQueryData<BootstrapData>(["schedule", projectId]);
      if (!data) throw new Error("No schedule cache");

      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error("No user");

      // 1. Insert the lookahead.
      const { data: lookaheadRow, error: insertErr } = await sb
        .from("lookaheads")
        .insert({
          project_id: projectId,
          name: vars.name,
          window_start: vars.windowStart,
          window_end: vars.windowEnd,
          type: vars.type,
          source_mode: "from_master",
          created_by: user.id,
        })
        .select(LOOKAHEAD_SELECT)
        .single();

      if (insertErr || !lookaheadRow) {
        toast.error(`Couldn't create lookahead: ${insertErr?.message ?? "unknown"}`);
        throw new Error(insertErr?.message ?? "Insert failed");
      }

      const newLookahead = lookaheadRow as unknown as DbLookahead;

      // Optimistically add the new lookahead to the cache.
      qc.setQueryData(["schedule", projectId], (prev: BootstrapData | undefined) => {
        if (!prev) return prev;
        return { ...prev, lookaheads: [...prev.lookaheads, newLookahead] };
      });

      // 2. Compute masters in window and bulk-insert tasks.
      const { mastersInWindow } = await import("./auto-populate");
      const { runRecalc } = await import("./recalc");
      const indexed = runRecalc(data);
      const masters = mastersInWindow(data, indexed, vars.windowStart, vars.windowEnd);

      if (masters.length === 0) {
        return { lookaheadId: newLookahead.id, taskCount: 0 };
      }

      const taskPayload = masters.map((a) => ({
        lookahead_id: newLookahead.id,
        master_activity_id: a.id,
        name: a.name,
        offset_start: 0,
        offset_finish: 0,
        responsible_company_id: a.responsible_company_id,
        status: "not_started",
        percent_complete: a.percent_complete,
      }));

      const { data: newTaskRows, error: taskErr } = await sb
        .from("lookahead_tasks")
        .insert(taskPayload)
        .select(
          "id, lookahead_id, master_activity_id, name, offset_start, offset_finish, " +
          "start_date, finish_date, crew, responsible_company_id, status, " +
          "percent_complete, constraints_cleared, readiness_notes, deleted_at",
        );

      if (taskErr) {
        toast.error("Lookahead created but no tasks loaded — use Re-populate.");
        return { lookaheadId: newLookahead.id, taskCount: 0 };
      }

      const newTasks = (newTaskRows ?? []) as unknown as DbLookaheadTask[];
      qc.setQueryData(["schedule", projectId], (prev: BootstrapData | undefined) => {
        if (!prev) return prev;
        return { ...prev, lookaheadTasks: [...prev.lookaheadTasks, ...newTasks] };
      });

      return { lookaheadId: newLookahead.id, taskCount: newTasks.length };
    },
  });
}

export function useUpdateLookahead(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["updateLookahead", projectId],
    mutationFn: async (vars: {
      lookaheadId: string;
      patch: Partial<Pick<DbLookahead, "name" | "window_start" | "window_end" | "type">>;
    }) => {
      const sb = createSupabaseBrowserClient();
      const data = qc.getQueryData<BootstrapData>(["schedule", projectId]);
      if (!data) return;

      qc.setQueryData(["schedule", projectId],
        applyOptimisticLookaheadPatch(data, vars.lookaheadId, vars.patch));

      const { error } = await sb
        .from("lookaheads")
        .update(vars.patch)
        .eq("id", vars.lookaheadId);

      if (error) {
        qc.setQueryData(["schedule", projectId], data);
        toast.error(`Couldn't save: ${error.message}`);
      }
    },
  });
}

export function useDeleteLookahead(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["deleteLookahead", projectId],
    mutationFn: async (vars: { lookaheadId: string }) => {
      const sb = createSupabaseBrowserClient();
      const data = qc.getQueryData<BootstrapData>(["schedule", projectId]);
      if (!data) return;

      const now = new Date().toISOString();
      qc.setQueryData(["schedule", projectId],
        softDeleteFromCache(data, "lookahead", vars.lookaheadId, now));

      const { error } = await sb
        .from("lookaheads")
        .update({ deleted_at: now })
        .eq("id", vars.lookaheadId);

      if (error) {
        qc.setQueryData(["schedule", projectId], data);
        toast.error(`Couldn't delete: ${error.message}`);
      }
    },
  });
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Verify lint passes**

```bash
npm run lint
```

Expected: no errors. (If there's a complaint about the unused `LOOKAHEAD_SELECT` constant: it's used implicitly in the `.select(...)` call — eslint should be fine. If lint flags it, leave the constant inline by replacing the variable with its literal string.)

- [ ] **Step 4: Verify the existing test suite still passes**

```bash
npm test
```

Expected: still 167 tests pass; nothing new added here (the hooks are exercised indirectly by Task 8 / Task 9).

- [ ] **Step 5: Commit**

```bash
git add src/lib/state/mutations.ts
git commit -m "$(cat <<'EOF'
feat: add useCreateLookahead, useUpdateLookahead, useDeleteLookahead

Create uses mastersInWindow to bulk-insert lookahead_tasks after the
parent insert. Update and delete are plain optimistic writes (no version
checks; soft-delete via deleted_at). All under RLS.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Task-level mutation hooks (insert, update, delete)

**Files:**
- Modify: `src/lib/state/mutations.ts`

- [ ] **Step 1: Append the three hooks to `src/lib/state/mutations.ts`**

Add the following block at the END of the file:

```ts
// --- Lookahead-task-level mutations -------------------------------------

const LOOKAHEAD_TASK_SELECT =
  "id, lookahead_id, master_activity_id, name, offset_start, offset_finish, " +
  "start_date, finish_date, crew, responsible_company_id, status, " +
  "percent_complete, constraints_cleared, readiness_notes, deleted_at";

export function useInsertLookaheadTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["insertLookaheadTask", projectId],
    mutationFn: async (vars: {
      lookaheadId: string;
      masterActivityId: string | null;
      name: string;
    }): Promise<DbLookaheadTask | null> => {
      const sb = createSupabaseBrowserClient();
      const data = qc.getQueryData<BootstrapData>(["schedule", projectId]);
      if (!data) return null;

      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error("No user");

      // Build defaults based on master-linked vs detached.
      let payload: Partial<DbLookaheadTask> & { lookahead_id: string };
      if (vars.masterActivityId) {
        const master = data.activities.find((a) => a.id === vars.masterActivityId);
        payload = {
          lookahead_id: vars.lookaheadId,
          master_activity_id: vars.masterActivityId,
          name: vars.name || master?.name || "Untitled",
          offset_start: 0,
          offset_finish: 0,
          start_date: null,
          finish_date: null,
          crew: null,
          responsible_company_id: master?.responsible_company_id ?? null,
          status: "not_started",
          percent_complete: 0,
        };
      } else {
        // Detached: need the user's company for the RLS default.
        const { data: userRow } = await sb
          .from("users")
          .select("company_id")
          .eq("id", user.id)
          .single();
        const today = new Date().toISOString().slice(0, 10);
        payload = {
          lookahead_id: vars.lookaheadId,
          master_activity_id: null,
          name: vars.name || "New task",
          offset_start: null,
          offset_finish: null,
          start_date: today,
          finish_date: today,
          crew: null,
          responsible_company_id: (userRow as { company_id: string } | null)?.company_id ?? null,
          status: "not_started",
          percent_complete: 0,
        };
      }

      const { data: inserted, error } = await sb
        .from("lookahead_tasks")
        .insert(payload)
        .select(LOOKAHEAD_TASK_SELECT)
        .single();

      if (error || !inserted) {
        toast.error(`Couldn't add task: ${error?.message ?? "unknown"}`);
        return null;
      }

      const newTask = inserted as unknown as DbLookaheadTask;
      qc.setQueryData(["schedule", projectId], (prev: BootstrapData | undefined) => {
        if (!prev) return prev;
        return { ...prev, lookaheadTasks: [...prev.lookaheadTasks, newTask] };
      });
      return newTask;
    },
  });
}

export function useUpdateLookaheadTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["updateLookaheadTask", projectId],
    mutationFn: async (vars: {
      taskId: string;
      patch: Partial<Pick<DbLookaheadTask,
        "name" | "master_activity_id" | "offset_start" | "offset_finish" |
        "start_date" | "finish_date" | "crew" | "responsible_company_id" |
        "status" | "percent_complete">>;
    }) => {
      const sb = createSupabaseBrowserClient();
      const data = qc.getQueryData<BootstrapData>(["schedule", projectId]);
      if (!data) return;

      qc.setQueryData(["schedule", projectId],
        applyOptimisticLookaheadTaskPatch(data, vars.taskId, vars.patch));

      const { error } = await sb
        .from("lookahead_tasks")
        .update(vars.patch)
        .eq("id", vars.taskId);

      if (error) {
        qc.setQueryData(["schedule", projectId], data);
        toast.error(`Couldn't save: ${error.message}`);
      }
    },
  });
}

export function useDeleteLookaheadTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["deleteLookaheadTask", projectId],
    mutationFn: async (vars: { taskId: string }) => {
      const sb = createSupabaseBrowserClient();
      const data = qc.getQueryData<BootstrapData>(["schedule", projectId]);
      if (!data) return;

      const now = new Date().toISOString();
      qc.setQueryData(["schedule", projectId],
        softDeleteFromCache(data, "lookaheadTask", vars.taskId, now));

      const { error } = await sb
        .from("lookahead_tasks")
        .update({ deleted_at: now })
        .eq("id", vars.taskId);

      if (error) {
        qc.setQueryData(["schedule", projectId], data);
        toast.error(`Couldn't delete: ${error.message}`);
      }
    },
  });
}
```

- [ ] **Step 2: Verify typecheck + lint + tests**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: typecheck clean, lint clean, all 167 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/state/mutations.ts
git commit -m "$(cat <<'EOF'
feat: add useInsertLookaheadTask, useUpdateLookaheadTask, useDeleteLookaheadTask

Insert applies different defaults for master-linked vs detached tasks;
detached default for responsible_company_id is the user's own company
(so trade-partner editors don't RLS-reject their own insert). Update +
delete are plain optimistic writes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `NewLookaheadModal` component

**Files:**
- Create: `src/components/schedule/Lookahead/NewLookaheadModal.tsx`
- Create: `src/components/schedule/Lookahead/NewLookaheadModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/schedule/Lookahead/NewLookaheadModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewLookaheadModal } from "./NewLookaheadModal";

describe("NewLookaheadModal", () => {
  it("submit is disabled when name is empty", () => {
    render(<NewLookaheadModal onSubmit={vi.fn()} onClose={vi.fn()} />);
    const submit = screen.getByRole("button", { name: /Create/ });
    expect(submit).toBeDisabled();
  });

  it("submit is disabled when window_start is after window_end", async () => {
    const user = userEvent.setup();
    render(<NewLookaheadModal onSubmit={vi.fn()} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText(/Name/), "Test");
    fireEvent.change(screen.getByLabelText(/Window start/), { target: { value: "2026-05-28" } });
    fireEvent.change(screen.getByLabelText(/Window end/), { target: { value: "2026-05-01" } });
    expect(screen.getByRole("button", { name: /Create/ })).toBeDisabled();
  });

  it("calls onSubmit with the form values when valid", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<NewLookaheadModal onSubmit={onSubmit} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText(/Name/), "Test LA");
    fireEvent.change(screen.getByLabelText(/Window start/), { target: { value: "2026-05-01" } });
    fireEvent.change(screen.getByLabelText(/Window end/), { target: { value: "2026-05-28" } });
    await user.type(screen.getByLabelText(/Type/), "weekly");
    await user.click(screen.getByRole("button", { name: /Create/ }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Test LA",
      windowStart: "2026-05-01",
      windowEnd: "2026-05-28",
      type: "weekly",
    });
  });

  it("calls onClose when the Cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<NewLookaheadModal onSubmit={vi.fn()} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test -- src/components/schedule/Lookahead/NewLookaheadModal.test.tsx
```

Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement the modal**

Create `src/components/schedule/Lookahead/NewLookaheadModal.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

interface SubmitArgs {
  name: string;
  windowStart: string;
  windowEnd: string;
  type: string | null;
}

interface Props {
  onSubmit: (args: SubmitArgs) => void;
  onClose: () => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function NewLookaheadModal({ onSubmit, onClose }: Props) {
  const [name, setName] = useState("");
  const [windowStart, setWindowStart] = useState(todayIso());
  const [windowEnd, setWindowEnd] = useState(addDays(todayIso(), 28));
  const [type, setType] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canSubmit = name.trim().length > 0 && windowStart <= windowEnd;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      name: name.trim(),
      windowStart,
      windowEnd,
      type: type.trim() === "" ? null : type.trim(),
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-lg"
      >
        <h2 className="mb-3 text-sm font-semibold text-slate-900">New Lookahead</h2>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
          />
        </label>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Window start</span>
            <input
              type="date"
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Window end</span>
            <input
              type="date"
              value={windowEnd}
              onChange={(e) => setWindowEnd(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
            />
          </label>
        </div>

        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Type (optional)</span>
          <input
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="e.g. weekly, rolling"
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
          />
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm test -- src/components/schedule/Lookahead/NewLookaheadModal.test.tsx
```

Expected: 4 tests pass.

- [ ] **Step 5: Verify the full test suite still passes**

```bash
npm test
```

Expected: 167 + 4 = 171 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/schedule/Lookahead/NewLookaheadModal.tsx src/components/schedule/Lookahead/NewLookaheadModal.test.tsx
git commit -m "$(cat <<'EOF'
feat: add NewLookaheadModal with name + window dates + optional type

Standalone presentational component: parent owns submit/close. Validates
name presence and window_start <= window_end. ESC + backdrop-click close.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `LookaheadTaskRow` component (inline edit)

**Files:**
- Create: `src/components/schedule/Lookahead/LookaheadTaskRow.tsx`
- Create: `src/components/schedule/Lookahead/LookaheadTaskRow.test.tsx`

This is the most complex new component. It owns its own per-cell edit state, mirrors the `WbsRow` inline-edit pattern, and shows the right columns based on whether the row is master-linked or detached.

- [ ] **Step 1: Write the failing test**

Create `src/components/schedule/Lookahead/LookaheadTaskRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LookaheadTaskRow } from "./LookaheadTaskRow";
import type { DbActivity, DbLookaheadTask } from "@/lib/schedule/types";

// `companies` is not in the bootstrap; use a minimal shape locally.
type CompanyMin = { id: string; name: string };

function task(over: Partial<DbLookaheadTask> = {}): DbLookaheadTask {
  return {
    id: over.id ?? "T1", lookahead_id: "L1", master_activity_id: null, name: "T1",
    offset_start: null, offset_finish: null, start_date: null, finish_date: null,
    crew: null, responsible_company_id: null, status: "not_started",
    percent_complete: 0, constraints_cleared: false, readiness_notes: null,
    deleted_at: null, ...over,
  };
}

function activity(over: Partial<DbActivity> = {}): DbActivity {
  return {
    id: over.id ?? "A1", project_id: "p", wbs_node_id: null, name: "Mobilize",
    activity_type: "task", original_duration: 1, remaining_duration: 1,
    calendar_id: null, actual_start: null, actual_finish: null,
    percent_complete: 0, responsible_company_id: null,
    early_start: null, early_finish: null, late_start: null, late_finish: null,
    planned_start: null, planned_finish: null, total_float: null, free_float: null,
    is_critical: false, version: 1, deleted_at: null, ...over,
  };
}

const baseProps = {
  masters: [activity({ id: "A1", name: "Mobilize" }), activity({ id: "A2", name: "Pour Foundations" })],
  companies: [{ id: "co-1", name: "IHS" }, { id: "co-2", name: "Acme Concrete" }] as CompanyMin[],
  computedStart: "2026-05-06",
  computedFinish: "2026-05-10",
  onUpdate: vi.fn(),
  onDelete: vi.fn(),
};

describe("LookaheadTaskRow — visibility", () => {
  it("hides offset cells for a detached task", () => {
    render(<table><tbody><LookaheadTaskRow {...baseProps} task={task({ master_activity_id: null })} /></tbody></table>);
    expect(screen.queryByLabelText(/offset start/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/offset finish/i)).not.toBeInTheDocument();
  });

  it("shows offset cells (read-only labels until clicked) for a master-linked task", () => {
    render(<table><tbody><LookaheadTaskRow {...baseProps} task={task({ master_activity_id: "A1", offset_start: 0, offset_finish: 0 })} /></tbody></table>);
    // Read-only labels show "0d" initially
    expect(screen.getAllByText("0d").length).toBeGreaterThan(0);
  });
});

describe("LookaheadTaskRow — inline edit", () => {
  it("commits a name change on Enter", async () => {
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    render(<table><tbody><LookaheadTaskRow {...baseProps} onUpdate={onUpdate} task={task({ id: "T1", name: "Old" })} /></tbody></table>);
    await user.dblClick(screen.getByText("Old"));
    const input = screen.getByDisplayValue("Old");
    await user.clear(input);
    await user.type(input, "New{Enter}");
    expect(onUpdate).toHaveBeenCalledWith("T1", { name: "New" });
  });

  it("reverts to the prior value on Escape", async () => {
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    render(<table><tbody><LookaheadTaskRow {...baseProps} onUpdate={onUpdate} task={task({ name: "Old" })} /></tbody></table>);
    await user.dblClick(screen.getByText("Old"));
    const input = screen.getByDisplayValue("Old");
    await user.clear(input);
    await user.type(input, "New{Escape}");
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText("Old")).toBeInTheDocument();
  });

  it("commits a % complete change on blur", async () => {
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    render(<table><tbody><LookaheadTaskRow {...baseProps} onUpdate={onUpdate} task={task({ id: "T1", percent_complete: 0 })} /></tbody></table>);
    await user.dblClick(screen.getByText("0%"));
    const input = screen.getByDisplayValue("0");
    await user.clear(input);
    await user.type(input, "50");
    fireEvent.blur(input);
    expect(onUpdate).toHaveBeenCalledWith("T1", { percent_complete: 50 });
  });

  it("calls onDelete when the delete button is clicked", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<table><tbody><LookaheadTaskRow {...baseProps} onDelete={onDelete} task={task({ id: "T1" })} /></tbody></table>);
    await user.click(screen.getByRole("button", { name: /Delete/ }));
    expect(onDelete).toHaveBeenCalledWith("T1");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test -- src/components/schedule/Lookahead/LookaheadTaskRow.test.tsx
```

Expected: FAIL (component does not exist).

- [ ] **Step 3: Implement the component**

Create `src/components/schedule/Lookahead/LookaheadTaskRow.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { DbActivity, DbLookaheadTask } from "@/lib/schedule/types";

type CompanyMin = { id: string; name: string };

const STATUS_OPTIONS = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "complete", label: "Complete" },
  { value: "blocked", label: "Blocked" },
] as const;

interface Props {
  task: DbLookaheadTask;
  masters: DbActivity[];
  companies: CompanyMin[];
  computedStart?: string;
  computedFinish?: string;
  onUpdate: (id: string, patch: Partial<DbLookaheadTask>) => void;
  onDelete: (id: string) => void;
}

type EditableField =
  | "name" | "master" | "offsetStart" | "offsetFinish"
  | "startDate" | "finishDate" | "crew" | "responsibleCompany"
  | "status" | "percentComplete";

export function LookaheadTaskRow({
  task, masters, companies, computedStart, computedFinish, onUpdate, onDelete,
}: Props) {
  const [editing, setEditing] = useState<EditableField | null>(null);
  const isMasterLinked = task.master_activity_id !== null;

  function commit<T>(field: keyof DbLookaheadTask, value: T) {
    setEditing(null);
    if (task[field] === value) return;
    onUpdate(task.id, { [field]: value } as Partial<DbLookaheadTask>);
  }

  function cancel() {
    setEditing(null);
  }

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50">
      {/* Master link */}
      <td className="px-2 py-1.5 text-xs">
        {editing === "master" ? (
          <select
            autoFocus
            defaultValue={task.master_activity_id ?? ""}
            onBlur={(e) => commit("master_activity_id", e.target.value || null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLSelectElement).blur();
              if (e.key === "Escape") cancel();
            }}
            className="rounded border border-sky-300 px-1 text-xs"
          >
            <option value="">Detached</option>
            {masters.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        ) : (
          <span
            className="cursor-text text-slate-500"
            onDoubleClick={() => setEditing("master")}
          >
            {isMasterLinked
              ? (masters.find((m) => m.id === task.master_activity_id)?.name ?? "(missing)")
              : "Detached"}
          </span>
        )}
      </td>

      {/* Name */}
      <td className="px-2 py-1.5 text-xs">
        {editing === "name" ? (
          <input
            autoFocus
            defaultValue={task.name}
            onBlur={(e) => commit("name", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") cancel();
            }}
            className="w-full rounded border border-sky-300 px-1 text-xs"
          />
        ) : (
          <span className="cursor-text" onDoubleClick={() => setEditing("name")}>
            {task.name}
          </span>
        )}
      </td>

      {/* Start */}
      <td className="px-2 py-1.5 text-xs text-slate-500">
        {isMasterLinked ? (
          <span>{computedStart ?? "—"}</span>
        ) : editing === "startDate" ? (
          <input
            type="date"
            autoFocus
            defaultValue={task.start_date ?? ""}
            onBlur={(e) => commit("start_date", e.target.value || null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") cancel();
            }}
            className="rounded border border-sky-300 px-1 text-xs"
          />
        ) : (
          <span className="cursor-text" onDoubleClick={() => setEditing("startDate")}>
            {task.start_date ?? "—"}
          </span>
        )}
      </td>

      {/* Finish */}
      <td className="px-2 py-1.5 text-xs text-slate-500">
        {isMasterLinked ? (
          <span>{computedFinish ?? "—"}</span>
        ) : editing === "finishDate" ? (
          <input
            type="date"
            autoFocus
            defaultValue={task.finish_date ?? ""}
            onBlur={(e) => commit("finish_date", e.target.value || null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") cancel();
            }}
            className="rounded border border-sky-300 px-1 text-xs"
          />
        ) : (
          <span className="cursor-text" onDoubleClick={() => setEditing("finishDate")}>
            {task.finish_date ?? "—"}
          </span>
        )}
      </td>

      {/* Offset start (master-linked only) */}
      <td className="px-2 py-1.5 text-xs text-slate-500">
        {!isMasterLinked ? null : editing === "offsetStart" ? (
          <input
            type="number"
            autoFocus
            aria-label="offset start"
            defaultValue={task.offset_start ?? 0}
            onBlur={(e) => commit("offset_start", parseInt(e.target.value, 10) || 0)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") cancel();
            }}
            className="w-14 rounded border border-sky-300 px-1 text-xs"
          />
        ) : (
          <span className="cursor-text" onDoubleClick={() => setEditing("offsetStart")}>
            {task.offset_start ?? 0}d
          </span>
        )}
      </td>

      {/* Offset finish (master-linked only) */}
      <td className="px-2 py-1.5 text-xs text-slate-500">
        {!isMasterLinked ? null : editing === "offsetFinish" ? (
          <input
            type="number"
            autoFocus
            aria-label="offset finish"
            defaultValue={task.offset_finish ?? 0}
            onBlur={(e) => commit("offset_finish", parseInt(e.target.value, 10) || 0)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") cancel();
            }}
            className="w-14 rounded border border-sky-300 px-1 text-xs"
          />
        ) : (
          <span className="cursor-text" onDoubleClick={() => setEditing("offsetFinish")}>
            {task.offset_finish ?? 0}d
          </span>
        )}
      </td>

      {/* Crew */}
      <td className="px-2 py-1.5 text-xs">
        {editing === "crew" ? (
          <input
            autoFocus
            defaultValue={task.crew ?? ""}
            onBlur={(e) => commit("crew", e.target.value || null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") cancel();
            }}
            className="w-24 rounded border border-sky-300 px-1 text-xs"
          />
        ) : (
          <span className="cursor-text" onDoubleClick={() => setEditing("crew")}>
            {task.crew ?? "—"}
          </span>
        )}
      </td>

      {/* Responsible company */}
      <td className="px-2 py-1.5 text-xs">
        {editing === "responsibleCompany" ? (
          <select
            autoFocus
            defaultValue={task.responsible_company_id ?? ""}
            onBlur={(e) => commit("responsible_company_id", e.target.value || null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLSelectElement).blur();
              if (e.key === "Escape") cancel();
            }}
            className="rounded border border-sky-300 px-1 text-xs"
          >
            <option value="">—</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        ) : (
          <span className="cursor-text" onDoubleClick={() => setEditing("responsibleCompany")}>
            {companies.find((c) => c.id === task.responsible_company_id)?.name ?? "—"}
          </span>
        )}
      </td>

      {/* Status */}
      <td className="px-2 py-1.5 text-xs">
        {editing === "status" ? (
          <select
            autoFocus
            defaultValue={task.status ?? "not_started"}
            onBlur={(e) => commit("status", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLSelectElement).blur();
              if (e.key === "Escape") cancel();
            }}
            className="rounded border border-sky-300 px-1 text-xs"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ) : (
          <span className="cursor-text" onDoubleClick={() => setEditing("status")}>
            {STATUS_OPTIONS.find((o) => o.value === task.status)?.label ?? "—"}
          </span>
        )}
      </td>

      {/* % complete */}
      <td className="px-2 py-1.5 text-xs">
        {editing === "percentComplete" ? (
          <input
            type="number"
            min={0}
            max={100}
            autoFocus
            defaultValue={Math.round(task.percent_complete)}
            onBlur={(e) => {
              const n = parseInt(e.target.value, 10);
              commit("percent_complete", Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") cancel();
            }}
            className="w-14 rounded border border-sky-300 px-1 text-xs"
          />
        ) : (
          <span className="cursor-text" onDoubleClick={() => setEditing("percentComplete")}>
            {Math.round(task.percent_complete)}%
          </span>
        )}
      </td>

      {/* Delete */}
      <td className="px-2 py-1.5 text-xs">
        <button
          type="button"
          aria-label="Delete"
          onClick={() => onDelete(task.id)}
          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 size={12} />
        </button>
      </td>
    </tr>
  );
}
```

Note: `src/lib/schedule/types.ts` does not currently export a `DbCompany` type. The test and component both use a local `CompanyMin = { id: string; name: string }` shape. If you later add a `DbCompany` to types, switch both to use it.

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm test -- src/components/schedule/Lookahead/LookaheadTaskRow.test.tsx
```

Expected: 5 tests pass.

- [ ] **Step 5: Verify the full suite still passes**

```bash
npm test
```

Expected: 171 + 5 = 176 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/schedule/Lookahead/LookaheadTaskRow.tsx src/components/schedule/Lookahead/LookaheadTaskRow.test.tsx
git commit -m "$(cat <<'EOF'
feat: add LookaheadTaskRow with per-cell inline editing

Mirrors the WbsRow inline-edit pattern (double-click to enter edit mode,
Enter/blur commits, Escape cancels). Hides offset cells for detached
tasks; shows computed dates as read-only for master-linked tasks and
editable date inputs for detached tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Rewire `LookaheadView` + integration test

**Files:**
- Modify: `src/components/schedule/Lookahead/LookaheadView.tsx`
- Create: `src/components/schedule/Lookahead/LookaheadView.test.tsx`

- [ ] **Step 1: Read the existing `LookaheadView.tsx` to confirm the read-path you're preserving**

```bash
cat "/Users/tanner/IHS- Scheduling Tool/src/components/schedule/Lookahead/LookaheadView.tsx"
```

Note: the existing file's `persistedRows` block (lines ~43–68) is the offset-resolution logic. The rewrite keeps that logic — it just feeds the rows into `<LookaheadTaskRow>` instead of inline `<tr>` elements, and gates the read-only "Auto" preview behind "no lookaheads exist".

- [ ] **Step 2: Write the failing integration test**

Create `src/components/schedule/Lookahead/LookaheadView.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LookaheadView } from "./LookaheadView";
import type { BootstrapData, IndexedResult, DbActivity, DbLookahead, DbLookaheadTask } from "@/lib/schedule/types";
import type { ScheduleResult } from "@/lib/schedule-engine";

function act(over: Partial<DbActivity> = {}): DbActivity {
  return {
    id: over.id ?? "A1", project_id: "p", wbs_node_id: null, name: "Mobilize",
    activity_type: "task", original_duration: 5, remaining_duration: 5,
    calendar_id: null, actual_start: null, actual_finish: null,
    percent_complete: 0, responsible_company_id: null,
    early_start: null, early_finish: null, late_start: null, late_finish: null,
    planned_start: null, planned_finish: null, total_float: null, free_float: null,
    is_critical: false, version: 1, deleted_at: null, ...over,
  };
}

function lookahead(over: Partial<DbLookahead> = {}): DbLookahead {
  return {
    id: over.id ?? "L1", project_id: "p", name: "Week 1",
    window_start: "2026-05-01", window_end: "2026-05-28",
    type: null, source_mode: "from_master", deleted_at: null, ...over,
  };
}

function task(over: Partial<DbLookaheadTask> = {}): DbLookaheadTask {
  return {
    id: over.id ?? "T1", lookahead_id: "L1", master_activity_id: null, name: "T1",
    offset_start: null, offset_finish: null, start_date: null, finish_date: null,
    crew: null, responsible_company_id: null, status: "not_started",
    percent_complete: 0, constraints_cleared: false, readiness_notes: null,
    deleted_at: null, ...over,
  };
}

function indexed(...rows: { id: string; plannedStart: string; plannedFinish: string }[]): IndexedResult {
  const byActivity = new Map<string, ScheduleResult["activities"][number]>();
  for (const r of rows) {
    byActivity.set(r.id, {
      id: r.id,
      earlyStart: r.plannedStart, earlyFinish: r.plannedFinish,
      lateStart: r.plannedStart, lateFinish: r.plannedFinish,
      plannedStart: r.plannedStart, plannedFinish: r.plannedFinish,
      totalFloat: 0, freeFloat: 0, isCritical: false,
    });
  }
  return { byActivity, projectFinish: null, problems: [] };
}

function makeBootstrap(): BootstrapData {
  return {
    project: { id: "p", name: "P", number: null, project_start: "2026-05-01",
      data_date: null, default_calendar_id: "c", critical_float_threshold: 0,
      comment_visibility_default: "internal" },
    calendars: [], calendarExceptions: [], wbsNodes: [],
    activities: [act({ id: "A1", name: "Mobilize" }), act({ id: "A2", name: "Pour" })],
    dependencies: [], constraints: [], comments: [], history: [],
    lookaheads: [lookahead()],
    lookaheadTasks: [
      task({ id: "T1", master_activity_id: "A1", name: "Mobilize", offset_start: 0, offset_finish: 0 }),
      task({ id: "T2", master_activity_id: null, name: "Site cleanup",
        start_date: "2026-05-15", finish_date: "2026-05-15" }),
    ],
  };
}

function Wrap({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("LookaheadView", () => {
  it("renders both tasks of the selected lookahead with resolved dates", () => {
    const bootstrap = makeBootstrap();
    const ix = indexed({ id: "A1", plannedStart: "2026-05-06", plannedFinish: "2026-05-10" });
    render(
      <Wrap>
        <LookaheadView bootstrap={bootstrap} indexed={ix} projectId="p" companies={[]} />
      </Wrap>,
    );
    // Both task rows are in the table
    expect(screen.getByText("Mobilize")).toBeInTheDocument();
    expect(screen.getByText("Site cleanup")).toBeInTheDocument();
    // Offset-linked computed start visible
    expect(screen.getByText("2026-05-06")).toBeInTheDocument();
    // Detached explicit date visible
    expect(screen.getByText("2026-05-15")).toBeInTheDocument();
  });

  it("shows the '+ New Lookahead' button", () => {
    const bootstrap = makeBootstrap();
    const ix = indexed();
    render(
      <Wrap>
        <LookaheadView bootstrap={bootstrap} indexed={ix} projectId="p" companies={[]} />
      </Wrap>,
    );
    expect(screen.getByRole("button", { name: /New Lookahead/ })).toBeInTheDocument();
  });

  it("shows the '+ Add Task' button when a lookahead is selected", () => {
    const bootstrap = makeBootstrap();
    const ix = indexed();
    render(
      <Wrap>
        <LookaheadView bootstrap={bootstrap} indexed={ix} projectId="p" companies={[]} />
      </Wrap>,
    );
    expect(screen.getByRole("button", { name: /Add Task/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

```bash
npm test -- src/components/schedule/Lookahead/LookaheadView.test.tsx
```

Expected: FAIL — the new `companies` and `projectId` props don't exist on the current component, and the buttons aren't rendered.

- [ ] **Step 4: Replace `LookaheadView.tsx`**

Replace the entire contents of `src/components/schedule/Lookahead/LookaheadView.tsx` with:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { BootstrapData, DbLookaheadTask, IndexedResult } from "@/lib/schedule/types";
import { isoAddDays } from "../Gantt/layout";
import {
  useCreateLookahead,
  useDeleteLookahead,
  useDeleteLookaheadTask,
  useInsertLookaheadTask,
  useUpdateLookaheadTask,
} from "@/lib/state/mutations";
import { NewLookaheadModal } from "./NewLookaheadModal";
import { LookaheadTaskRow } from "./LookaheadTaskRow";

type CompanyMin = { id: string; name: string };

interface Props {
  bootstrap: BootstrapData;
  indexed: IndexedResult;
  projectId: string;
  companies: CompanyMin[];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function LookaheadView({ bootstrap, indexed, projectId, companies }: Props) {
  const lookaheads = useMemo(
    () => bootstrap.lookaheads.filter((l) => l.deleted_at === null),
    [bootstrap.lookaheads],
  );

  const [selectedLookahead, setSelectedLookahead] = useState<string | null>(
    () => lookaheads[0]?.id ?? null,
  );
  const [modalOpen, setModalOpen] = useState(false);

  const createLookahead = useCreateLookahead(projectId);
  const deleteLookahead = useDeleteLookahead(projectId);
  const insertTask = useInsertLookaheadTask(projectId);
  const updateTask = useUpdateLookaheadTask(projectId);
  const deleteTask = useDeleteLookaheadTask(projectId);

  const lookahead = lookaheads.find((l) => l.id === selectedLookahead) ?? null;

  const masters = useMemo(
    () => bootstrap.activities.filter(
      (a) => a.deleted_at === null
        && (a.activity_type === "task" || a.activity_type === "milestone"),
    ),
    [bootstrap.activities],
  );

  // --- Read path: same as Phase 4 T17 ---------------------------------

  const adhocRows = useMemo(() => {
    if (lookahead) return [];
    const start = todayIso();
    const end = isoAddDays(start, 28);
    return bootstrap.activities
      .filter((a) => a.deleted_at === null)
      .map((a) => {
        const r = indexed.byActivity.get(a.id);
        return r ? { ...a, _start: r.plannedStart, _finish: r.plannedFinish } : null;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .filter((row) => row._start <= end && row._finish >= start)
      .map((row) => ({
        id: row.id, name: row.name, start: row._start, finish: row._finish,
        pct: Math.round(row.percent_complete),
      }));
  }, [lookahead, bootstrap.activities, indexed]);

  const tasksForLookahead: DbLookaheadTask[] = useMemo(() => {
    if (!lookahead) return [];
    return bootstrap.lookaheadTasks
      .filter((t) => t.lookahead_id === lookahead.id && t.deleted_at === null);
  }, [lookahead, bootstrap.lookaheadTasks]);

  function computedStart(t: DbLookaheadTask): string | undefined {
    if (!t.master_activity_id) return t.start_date ?? undefined;
    const m = indexed.byActivity.get(t.master_activity_id);
    if (!m) return undefined;
    return isoAddDays(m.plannedStart, t.offset_start ?? 0);
  }
  function computedFinish(t: DbLookaheadTask): string | undefined {
    if (!t.master_activity_id) return t.finish_date ?? undefined;
    const m = indexed.byActivity.get(t.master_activity_id);
    if (!m) return undefined;
    return isoAddDays(m.plannedFinish, t.offset_finish ?? 0);
  }

  // --- Handlers --------------------------------------------------------

  async function onCreateLookahead(args: { name: string; windowStart: string; windowEnd: string; type: string | null }) {
    const res = await createLookahead.mutateAsync(args);
    setModalOpen(false);
    setSelectedLookahead(res.lookaheadId);
  }

  function onAddTask() {
    if (!lookahead) return;
    // Default new task is detached, empty name; user immediately edits it.
    insertTask.mutate({ lookaheadId: lookahead.id, masterActivityId: null, name: "" });
  }

  function onRepopulate() {
    if (!lookahead) return;
    // Re-run mastersInWindow against the current cache and bulk-insert.
    // We piggyback on useCreateLookahead's logic by computing here instead.
    const { plannedStart, plannedFinish } = { plannedStart: lookahead.window_start, plannedFinish: lookahead.window_end };
    const inWindow = masters.filter((a) => {
      const r = indexed.byActivity.get(a.id);
      if (!r) return false;
      return r.plannedStart <= plannedFinish && r.plannedFinish >= plannedStart;
    });
    for (const a of inWindow) {
      insertTask.mutate({ lookaheadId: lookahead.id, masterActivityId: a.id, name: a.name });
    }
  }

  function onDeleteLookahead() {
    if (!lookahead) return;
    deleteLookahead.mutate({ lookaheadId: lookahead.id });
    setSelectedLookahead(null);
  }

  // --- Render ----------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs">
        <span className="text-slate-500">Lookahead:</span>
        <select
          value={selectedLookahead ?? ""}
          onChange={(e) => setSelectedLookahead(e.target.value || null)}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
        >
          <option value="">Auto (next 4 weeks of master)</option>
          {lookaheads.map((l) => (
            <option key={l.id} value={l.id}>{l.name} ({l.window_start}…{l.window_end})</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
        >
          + New Lookahead
        </button>
        {lookahead && (
          <button
            type="button"
            onClick={onDeleteLookahead}
            className="ml-auto rounded border border-slate-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
          >
            Delete Lookahead
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {!lookahead ? (
          // No lookahead selected → original auto preview
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-100 text-slate-700">
              <tr>
                <th className="px-2 py-1.5 text-left">Task</th>
                <th className="w-28 px-2 py-1.5 text-left">Start</th>
                <th className="w-28 px-2 py-1.5 text-left">Finish</th>
                <th className="w-20 px-2 py-1.5 text-left">% Comp</th>
              </tr>
            </thead>
            <tbody>
              {adhocRows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="px-2 py-1.5">{r.name}</td>
                  <td className="px-2 py-1.5">{r.start}</td>
                  <td className="px-2 py-1.5">{r.finish}</td>
                  <td className="px-2 py-1.5">{r.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tasksForLookahead.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-xs text-slate-500">
            <span>No tasks yet.</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onAddTask}
                className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700"
              >
                + Add Task
              </button>
              <button
                type="button"
                onClick={onRepopulate}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
              >
                Re-populate from master
              </button>
            </div>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-100 text-slate-700">
              <tr>
                <th className="px-2 py-1.5 text-left">Master</th>
                <th className="px-2 py-1.5 text-left">Task</th>
                <th className="w-24 px-2 py-1.5 text-left">Start</th>
                <th className="w-24 px-2 py-1.5 text-left">Finish</th>
                <th className="w-14 px-2 py-1.5 text-left">Off→</th>
                <th className="w-14 px-2 py-1.5 text-left">→Off</th>
                <th className="w-24 px-2 py-1.5 text-left">Crew</th>
                <th className="w-32 px-2 py-1.5 text-left">Responsible</th>
                <th className="w-28 px-2 py-1.5 text-left">Status</th>
                <th className="w-16 px-2 py-1.5 text-left">% Comp</th>
                <th className="w-8 px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {tasksForLookahead.map((t) => (
                <LookaheadTaskRow
                  key={t.id}
                  task={t}
                  masters={masters}
                  companies={companies}
                  computedStart={computedStart(t)}
                  computedFinish={computedFinish(t)}
                  onUpdate={(id, patch) => updateTask.mutate({ taskId: id, patch })}
                  onDelete={(id) => deleteTask.mutate({ taskId: id })}
                />
              ))}
              <tr>
                <td colSpan={11} className="px-2 py-2">
                  <button
                    type="button"
                    onClick={onAddTask}
                    className="rounded border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    + Add Task
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <NewLookaheadModal
          onSubmit={onCreateLookahead}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Update `ScheduleApp` to pass `projectId` and `companies` to LookaheadView**

`projectId` is already a prop on `ScheduleApp` (and already passed to `ActivityTable`, `GanttChart`, `SidePanel`). Only two changes are needed in `src/components/schedule/ScheduleApp.tsx`:

(a) Replace the existing import line:

```tsx
import { useEffect, useMemo } from "react";
```

with:

```tsx
import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
```

(b) Inside the `ScheduleApp` function body, just after the `useMemo` line that computes `indexed`, add:

```tsx
const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
useEffect(() => {
  const sb = createSupabaseBrowserClient();
  sb.from("companies").select("id, name").then((res) => {
    if (!res.error && res.data) setCompanies(res.data);
  });
}, []);
```

(c) Change this line:

```tsx
{view === "lookahead" && <LookaheadView bootstrap={bootstrap} indexed={indexed} />}
```

to:

```tsx
{view === "lookahead" && <LookaheadView bootstrap={bootstrap} indexed={indexed} projectId={projectId} companies={companies} />}
```

- [ ] **Step 6: Run the component-integration test**

```bash
npm test -- src/components/schedule/Lookahead/LookaheadView.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 7: Run typecheck + lint + full test suite**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: typecheck clean, lint clean, 176 + 3 = 179 tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/schedule/Lookahead/LookaheadView.tsx \
        src/components/schedule/Lookahead/LookaheadView.test.tsx \
        src/components/schedule/ScheduleApp.tsx
git commit -m "$(cat <<'EOF'
feat: wire LookaheadView with create / add task / edit / delete

Replaces the read-only Phase 4 T17 view with a fully editable lookahead.
Adds the modal mount, the empty-state Re-populate recovery button, and
inline edits via LookaheadTaskRow. Auto-preview unchanged when no
lookahead is selected.

ScheduleApp now fetches the project's companies once on mount and passes
them to LookaheadView for the responsible-company dropdown.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: E2E happy-path

**Files:**
- Create: `tests/e2e/lookahead-flow.spec.ts`

- [ ] **Step 1: Confirm Supabase is reachable + seed data exists**

Before writing the test, manually verify that you can sign in as `scheduler@ihs.test` and reach the project. If not, run `supabase start` / load the seed per the project's local setup (see existing `tests/e2e/scheduler-happy-path.spec.ts` for the reference flow).

- [ ] **Step 2: Write the E2E**

Create `tests/e2e/lookahead-flow.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("lookahead create + edit + delete flow", async ({ page }) => {
  // Sign in
  await page.goto("/login");
  await page.getByLabel("Email").fill("scheduler@ihs.test");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Land on the schedule
  await expect(page.getByText("Riverside Office Build")).toBeVisible({ timeout: 10_000 });

  // Switch to Lookahead view
  await page.getByRole("button", { name: "Lookahead" }).click();

  // Open New Lookahead modal
  await page.getByRole("button", { name: /New Lookahead/ }).click();
  await expect(page.getByRole("heading", { name: /New Lookahead/ })).toBeVisible();

  // Fill the form. Window covers a chunk of the seeded schedule so something gets auto-populated.
  const unique = `E2E ${Date.now()}`;
  await page.getByLabel(/Name/).fill(unique);
  await page.getByLabel(/Window start/).fill("2026-05-01");
  await page.getByLabel(/Window end/).fill("2026-06-30");

  await page.getByRole("button", { name: /Create/ }).click();

  // Modal closes, lookahead appears in dropdown
  await expect(page.getByRole("heading", { name: /New Lookahead/ })).not.toBeVisible();
  await expect(page.getByRole("combobox").first()).toContainText(unique);

  // The table shows tasks (auto-populated from master) — assert at least one task row exists
  // by finding the "+ Add Task" footer button (only rendered when there's a task table)
  await expect(page.getByRole("button", { name: /Add Task/ }).last()).toBeVisible();

  // Edit one task's % complete: scope the input to the cell so it doesn't
  // collide with the offset inputs (which also default to "0").
  const pctCell = page.locator("td", { hasText: /^0%$/ }).first();
  await pctCell.dblclick();
  const pctInput = pctCell.locator("input");
  await pctInput.fill("50");
  await pctInput.blur();

  // Reload to confirm persistence
  await page.reload();
  await page.getByRole("button", { name: "Lookahead" }).click();
  await expect(page.locator("td", { hasText: /^50%$/ }).first()).toBeVisible({ timeout: 5_000 });

  // Add a detached task (default name "New task", detached, today/today)
  await page.getByRole("button", { name: /Add Task/ }).last().click();
  // The new row is the last row in the table; rename it to "Safety meeting"
  const detachedRow = page.locator("tr", { hasText: /Detached/ }).last();
  await detachedRow.getByText("New task").dblclick();
  const nameInput = detachedRow.locator("input").first();
  await nameInput.fill("Safety meeting");
  await nameInput.press("Enter");
  await expect(detachedRow.getByText("Safety meeting")).toBeVisible();

  // Delete the detached task
  await detachedRow.getByRole("button", { name: /Delete/ }).click();
  await expect(page.locator("tr", { hasText: "Safety meeting" })).not.toBeVisible();

  // Delete the entire lookahead
  await page.getByRole("button", { name: /Delete Lookahead/ }).click();

  // Dropdown returns to the Auto preview (the unique lookahead is gone)
  await expect(page.getByRole("combobox").first()).not.toContainText(unique);
});
```

- [ ] **Step 3: Run the E2E**

```bash
npm run test:e2e -- tests/e2e/lookahead-flow.spec.ts
```

Expected: PASS.

If Playwright's strict-mode complains about ambiguous selectors, narrow them — Phase 4 errata #15 and #16 documented the same issue. The pattern: use `.first()`, `.last()`, or `page.locator("li").locator(...)` to scope. The detached-row sequence in step 5 is the most likely to need adjustment; use Playwright's trace viewer if a step fails.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/lookahead-flow.spec.ts
git commit -m "$(cat <<'EOF'
test: add Playwright happy-path E2E for lookahead create/edit/delete

Signs in as scheduler, creates a lookahead with a wide window so the
auto-populate fills it, edits a task's percent_complete and verifies
persistence after reload, adds and deletes a detached task, then
deletes the lookahead.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Manual smoke + push + open PR

**Files:** none.

- [ ] **Step 1: Run the full local suite**

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Expected: all four succeed. 179 unit tests pass.

- [ ] **Step 2: Manual browser smoke (developer-driven, not automated)**

```bash
npm run dev
```

In a browser at `http://localhost:3000`, sign in as `scheduler@ihs.test`, switch to the Lookahead view, and confirm:

1. **Empty state:** with no lookaheads selected, the "Auto (next 4 weeks)" preview renders, and a "+ New Lookahead" button is visible.
2. **Create flow:** click "+ New Lookahead", fill the form, submit. Modal closes, dropdown updates, table populates with master activities.
3. **Inline edits:**
   - Double-click a task name → edit → Enter → persists across page reload.
   - Double-click `% Comp` → type 75 → blur → persists.
   - Double-click `Status` → pick "Complete" → persists.
   - Double-click `Off→` (offset start) on a master-linked row → set to 2 → start date shifts by 2 days.
4. **Add a detached task:** click "+ Add Task" → row appears with "Detached", "New task", today/today → rename → edit dates → persists.
5. **Delete:** click the trash icon on a row → row disappears optimistically; reload → still gone.
6. **Delete the lookahead:** "Delete Lookahead" button → dropdown returns to Auto preview.
7. **Modal UX:** open the modal, press Escape → closes. Open again, click outside the form → closes. Submit with empty name → submit button disabled.
8. **Toast on RLS reject** (optional): sign in as `tp-viewer@trade.test`, try to edit a row → toast appears, change is rolled back.

Stop the dev server when done.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feat/section-5-lookahead
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "Section 5: Lookahead Module (Field-usable v1)" --body "$(cat <<'EOF'
## Summary
- Field-usable v1 of the Lookahead module (spec: `docs/superpowers/specs/2026-05-23-section-5-lookahead-design.md`).
- Schedulers can create a lookahead via modal; auto-populates with master activities whose engine-computed dates intersect the window.
- Inline cell editing for name, master link, offset/explicit dates, crew, responsible company, status, %comp.
- Detached tasks supported.
- Soft-delete for tasks and lookaheads.
- All writes via `@supabase/supabase-js` under RLS — no migrations, no server actions, no RPCs.

## Out of scope (deferred to a Section 5 v2)
- `source_mode = 'carry_forward'`
- Field % rollup to master (§5.6)
- Compare-to-latest-master view (§5.7)
- Readiness/constraint UI (§5.4)
- History rows for lookahead edits
- External-user lookahead E2E

## Test plan
- [x] `npm run lint` clean
- [x] `npm run typecheck` clean
- [x] `npm test` — all unit + component tests pass
- [x] `npm run build` succeeds
- [x] `npm run test:e2e -- tests/e2e/lookahead-flow.spec.ts` passes
- [ ] Reviewer manual smoke: create a lookahead, edit a few cells, add a detached task, delete the lookahead

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Note the PR URL for follow-up.**

The PR will need a review + merge by you. Once merged, this phase is complete — the Section 5 v2 backlog (carry_forward, rollup, compare, readiness) can be picked up as its own brainstorming round when prioritized.
