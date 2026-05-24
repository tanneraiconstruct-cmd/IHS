# Section 5 — Lookahead Module, Field-Usable v1 (Design Spec)

> **Status:** Draft, pending user review.
> **Scope:** Section 5 (The Lookahead Module) of `docs/SCHEDULING-TOOL-PLAN.md`. This is the "Field-usable v1" cut — explicit subset noted below.
> **Date:** 2026-05-23
> **Branch:** `docs/section-5-design` (spec lands here; implementation will follow on `feat/section-5-lookahead`).

---

## 1. Scope & Decisions

This phase delivers the **smallest cut that makes the Lookahead module useful in the field**: schedulers can create a lookahead, the system auto-populates it with master activities in the window, and supers/trade partners can add, edit, and delete tasks (with inline cell editing). The "auto-shift with master" behavior works via render-time offset resolution — already half-implemented in the existing read-only `LookaheadView`.

### In scope

- **Create a lookahead** via a modal form (name, window_start, window_end, optional `type`). `source_mode` is hardcoded to `'from_master'` in v1.
- **Auto-populate on create** — when the lookahead is created, the client inserts one `lookahead_task` per master activity whose engine-computed dates intersect the window (`offset_start = 0`, `offset_finish = 0`, defaults inherited from the master).
- **Add a task** via "+ Add Task" footer button on the lookahead table.
- **Detached tasks** — tasks with `master_activity_id = null` and explicit `start_date` / `finish_date`. Common for field-only steps (safety meeting, site cleanup) that have no master parent.
- **Inline cell editing** for: name, master link, offset_start, offset_finish (or start/finish for detached), crew, responsible company, status, % complete.
- **Soft-delete** a task; soft-delete a lookahead.
- **Render-time offset resolution** — task start/finish is `isoAddDays(master.plannedStart, offset_start)` / `isoAddDays(master.plannedFinish, offset_finish)`, computed every render. No write-fan-out when masters move.
- **Empty states** — no lookaheads → existing "Auto (next 4 weeks)" preview stays + a "+ Create Lookahead" CTA; lookahead with 0 tasks → "+ Add Task" + "Re-populate from master" recovery button.
- **TanStack Query mutations** — six new hooks; optimistic update + rollback + toast on error; mirrors the Phase 4 mutation infrastructure exactly.
- **All access via `@supabase/supabase-js` under RLS** — no new server actions, no new Postgres functions, no migrations.

### Out of scope (deferred to a Section 5 v2)

- **`source_mode = 'carry_forward'`** — the second source mode (§5.5). Schema already supports the enum value, but no UI / logic. The "+ New Lookahead" modal will only allow `from_master`.
- **Field progress rollup to master (§5.6)** — when a lookahead task's `percent_complete` changes, the master activity's `percent_complete` is NOT updated. Auto-rollup policy (internal vs external review) deferred.
- **Compare to Latest Master view (§5.7)** — no comparison visualization, no side-panel "diverged-from-master" indicator.
- **Readiness / constraint planning UI (§5.4)** — `constraints_cleared` and `readiness_notes` fields exist on the table and are kept in DB writes, but no UI to set them in v1.
- **History rows for lookahead-task edits** — `activity_history` is still only for master activity / dependency edits. Lookahead changes are not logged in v1.
- **External-user E2E** for lookaheads. RLS is verified by Phase 4's `external-user.spec.ts`; lookahead RLS uses the same `has_capability(...)` patterns. We add an external-user lookahead E2E only when carry_forward / rollup / compare land.
- **Concurrency / version checks** — `lookahead_tasks` has no `version` column; writes are last-write-wins (same posture as Phase 4 cascade-write rows). Phase 6 realtime fixes this for everything.

### Locked decisions

| Open decision | Choice | Rationale |
|---|---|---|
| §5.9(a) Offset-linked vs independent task model | **Offset-linked default** | Matches §5.2 Option A (the Procore "auto-shift" magic). Schema supports both; detached tasks (no master) fall back to explicit dates. |
| §5.9(b) Auto-rollup of field progress | **Deferred to v2** | Out of Field-usable v1 scope. |
| §5.9(c) Readiness / constraint tracking | **Deferred to v2** | Fields preserved in schema and writes; no UI. |
| §5.9(d) External editor permissions | **Already resolved** | RLS policies (`20260522145151_rls_policies.sql`) gate `lookahead_tasks` insert/update to `responsible_company_id = users.company_id`. Nothing to add. |
| Auto-shift mechanism | **Render-time only** | Lookahead tasks store offsets; the UI resolves them against `IndexedResult.byActivity` every render. No DB writes when masters move. Already half-implemented in the existing LookaheadView. |
| Create-flow population | **Auto-populate from master** | Matches §5.1 ("pulls all master activities intersecting the window"). User then renames / splits / breaks tasks down. |
| Edit UX | **Inline cell edits** | Matches Phase 4's ActivityTable pattern. New tasks added via an "Add row" button at the table footer. |
| Architecture | **Client-side, plain CRUD** | Matches the Phase 4 "no server actions, no RPCs, RLS-is-the-only-boundary" posture exactly. No migrations, no new server surface. |
| New Lookahead form | **Modal** | Multi-field form (name + window dates + type) doesn't fit inline. One-off pattern; not enough to justify a generic modal abstraction. |

---

## 2. Background — What Already Exists

The following are in place from Phase 2 (data model) and Phase 4 (UI). The v1 build does **not** modify any of them.

### 2.1 Data model (Phase 2)

- `lookaheads` table — `id`, `project_id`, `name`, `window_start`, `window_end`, `type` (nullable), `source_mode` (`from_master` | `carry_forward`), `created_by`, `created_at`, `deleted_at`.
- `lookahead_tasks` table — `id`, `lookahead_id`, `master_activity_id` (nullable for detached), `name`, `offset_start` (int, nullable), `offset_finish` (int, nullable), `start_date` (nullable), `finish_date` (nullable), `crew`, `responsible_company_id`, `status` (text), `percent_complete` (numeric), `constraints_cleared` (bool), `readiness_notes`, `created_at`, `deleted_at`.
- `lookahead_source_mode` enum already includes both `'from_master'` and `'carry_forward'`.

### 2.2 RLS (Phase 2)

- `lookaheads_select` — any project member.
- `lookaheads_insert` / `lookaheads_update` — `has_capability('create_lookahead', project_id)`. Capability is granted to `org_admin`, `project_admin`, `scheduler`, `project_manager`, `superintendent`.
- `lookahead_tasks_select` — any project member.
- `lookahead_tasks_insert` / `lookahead_tasks_update` — `has_capability('edit_lookahead_tasks', project_id, …)` with the trade-partner-editor scope restricting them to rows where `responsible_company_id = users.company_id`.

### 2.3 UI (Phase 4 T17)

`src/components/schedule/Lookahead/LookaheadView.tsx` already:
- Lists project lookaheads in a `<select>` dropdown.
- Renders a table of tasks for the selected lookahead, resolving offsets against `IndexedResult.byActivity` to compute start/finish.
- Falls back to an "Auto (next 4 weeks)" preview that shows master activities in the upcoming 4-week window when no lookahead is selected.

It is **read-only**. All read-path logic is correct and stays.

### 2.4 Bootstrap fetch (Phase 4 T7)

`fetchBootstrap` already loads `lookaheads` and `lookahead_tasks` for the project. Nothing to change in the fetcher.

---

## 3. Architecture & Data Flow

### 3.1 Read path

Unchanged from Phase 4. For each `lookahead_task`:
```
master = indexed.byActivity.get(task.master_activity_id)
if master:
  start  = isoAddDays(master.plannedStart,  task.offset_start)
  finish = isoAddDays(master.plannedFinish, task.offset_finish)
else if task.start_date && task.finish_date:  // detached
  start  = task.start_date
  finish = task.finish_date
else:
  start = finish = "—"
```

### 3.2 Write path

All writes are client-side via `@supabase/supabase-js`, wrapped in TanStack Query mutation hooks that follow the Phase 4 pattern: `onMutate` snapshots and patches the cache optimistically, `onError` rolls back and toasts, `onSettled` does not invalidate (the optimistic write is the source of truth until the next user-triggered refresh).

### 3.3 Engine integration

**None.** Lookahead tasks are not engine inputs. `buildEngineInput` continues to ignore them.

### 3.4 Concurrency

`lookahead_tasks` has no `version` column. Writes are plain `update().eq('id', id)` — last-write-wins, no version check, no conflict toast. This is the same posture Phase 4 uses for cascade-write rows. Phase 6 realtime + server-side reconciliation will fix this for everything in one pass.

### 3.5 RLS posture

The Phase 2 policies are sufficient. Insert/update on `lookahead_tasks` is gated server-side by `has_capability('edit_lookahead_tasks', project_id, responsible_company_id = users.company_id)`. The UI does no role gating — when an external editor tries to insert a task with `responsible_company_id` set to a different company, the RLS reject surfaces as a toast.

---

## 4. Data Model — No Deltas

No schema changes, no migrations, no new RPCs. The only field the schema is missing for v1 is a `version` column on `lookahead_tasks`, which is intentionally deferred (see §3.4).

---

## 5. UI Surface

### 5.1 New components

| File | Responsibility |
|---|---|
| `src/components/schedule/Lookahead/NewLookaheadModal.tsx` | Modal form: name, window_start, window_end, optional type. Submit → `useCreateLookahead()`. Closes on success. |
| `src/components/schedule/Lookahead/LookaheadTaskRow.tsx` | One row of the lookahead table; owns its own per-cell edit state (which cell is in edit mode, draft value, blur-vs-Esc handlers). |

### 5.2 Modified component

| File | Change |
|---|---|
| `src/components/schedule/Lookahead/LookaheadView.tsx` | Add "+ New Lookahead" button next to the lookahead `<select>`. When a lookahead is selected: render `LookaheadTaskRow` per task; add "+ Add Task" footer button. Per-row Delete button. Re-populate-from-master button on the empty-tasks state. |

### 5.3 Editable cells per task row

| Column | Editor | Visibility |
|---|---|---|
| Master link | dropdown (project activities + "Detached") | always |
| Name | text input | always |
| Start | read-only label (computed) | offset-linked |
| Start | date input | detached |
| Finish | read-only label (computed) | offset-linked |
| Finish | date input | detached |
| Offset start (days) | numeric input | offset-linked only |
| Offset finish (days) | numeric input | offset-linked only |
| Crew | text input | always |
| Responsible co. | dropdown (project companies) | always |
| Status | dropdown: `not_started`, `in_progress`, `complete`, `blocked` | always |
| % complete | numeric input (0–100) | always |
| Delete | button | always |

**Interaction:** click cell → input replaces label → blur or Enter commits → optimistic mutation → toast on failure. Esc reverts to the prior value.

### 5.4 Status enum

Status is a small fixed client-side list of strings: `not_started`, `in_progress`, `complete`, `blocked`. The DB column stays `text` (no migration). The dropdown is the only entry point, so DB-side validation is unnecessary.

### 5.5 New Lookahead modal

Fields: `name` (required text), `window_start` (required date), `window_end` (required date), `type` (optional text). Submit disabled when name is blank or `window_start > window_end`. Submit triggers `useCreateLookahead()`; the modal closes on success.

### 5.6 Empty states

| State | Display |
|---|---|
| No lookaheads at all | Existing "Auto (next 4 weeks)" preview + "+ Create Lookahead" CTA. |
| Lookahead selected, 0 tasks | "No tasks yet. + Add Task" + "Re-populate from master" recovery button. |
| Lookahead selected, ≥1 tasks | Table renders normally. |

---

## 6. Mutation Hooks Contract

All six hooks are added to `src/lib/state/mutations.ts`, alongside the Phase 4 mutation hooks. Each one follows the standard Phase 4 mutation shape (`onMutate` snapshots + patches cache; `mutationFn` does the supabase call; `onError` rolls back + toasts; `onSettled` is a no-op).

```ts
useCreateLookahead(): UseMutationResult<
  { lookaheadId: string; taskCount: number },
  Error,
  { projectId: string;
    name: string;
    windowStart: string;
    windowEnd: string;
    type: string | null }
>

useUpdateLookahead(): UseMutationResult<
  void, Error,
  { lookaheadId: string;
    patch: Partial<Pick<DbLookahead, 'name'|'window_start'|'window_end'|'type'>> }
>

useDeleteLookahead(): UseMutationResult<
  void, Error,
  { lookaheadId: string }
>

useInsertLookaheadTask(): UseMutationResult<
  DbLookaheadTask, Error,
  { lookaheadId: string;
    masterActivityId: string | null;
    name: string }
>
// Defaults applied: offset_start=0, offset_finish=0 (offset-linked)
// or start_date=today, finish_date=today, offset_start=null, offset_finish=null (detached)

useUpdateLookaheadTask(): UseMutationResult<
  void, Error,
  { taskId: string;
    patch: Partial<Pick<DbLookaheadTask,
      'name'|'master_activity_id'|'offset_start'|'offset_finish'|
      'start_date'|'finish_date'|'crew'|'responsible_company_id'|
      'status'|'percent_complete'>> }
>

useDeleteLookaheadTask(): UseMutationResult<
  void, Error,
  { taskId: string }
>
```

### 6.1 Auto-populate algorithm

Inside `useCreateLookahead`:

```
1. Read bootstrap from cache; compute indexed via existing useScheduleResult().
2. Read authed user: { data: { user } } = await supabase.auth.getUser()
   (Needed for the lookaheads.created_by NOT NULL column.)
3. mastersInWindow = bootstrap.activities.filter(a =>
     a.deleted_at === null
     && (a.activity_type === 'task' || a.activity_type === 'milestone')
     && (() => {
          const r = indexed.byActivity.get(a.id);
          if (!r) return false;
          return r.plannedStart <= windowEnd && r.plannedFinish >= windowStart;
        })())
4. lookaheadId = await supabase.from('lookaheads').insert({
     project_id, name, window_start, window_end, type,
     source_mode: 'from_master',
     created_by: user.id,
   }).select('id').single()
5. await supabase.from('lookahead_tasks').insert(
     mastersInWindow.map(a => ({
       lookahead_id: lookaheadId,
       master_activity_id: a.id,
       name: a.name,
       offset_start: 0,
       offset_finish: 0,
       responsible_company_id: a.responsible_company_id,
       status: 'not_started',
       percent_complete: a.percent_complete,
     }))
   )
6. return { lookaheadId, taskCount: mastersInWindow.length }
```

`mastersInWindow` is extracted as a pure exported function — `mastersInWindow(bootstrap, indexed, windowStart, windowEnd)` — so it is directly unit-testable independent of the mutation.

### 6.1a Defaults for `useInsertLookaheadTask`

The "+ Add Task" footer button calls this hook. Defaults depend on whether the new task is master-linked or detached:

| Field | Master-linked default | Detached default |
|---|---|---|
| `master_activity_id` | the selected master's id | `null` |
| `name` | the master's `name` | `""` (empty; user types) |
| `offset_start` | `0` | `null` |
| `offset_finish` | `0` | `null` |
| `start_date` | `null` | `today` (ISO) |
| `finish_date` | `null` | `today` (ISO) |
| `crew` | `null` | `null` |
| `responsible_company_id` | master's `responsible_company_id` | the authed user's `company_id` (via `select company_id from users where id = auth.uid()`) |
| `status` | `'not_started'` | `'not_started'` |
| `percent_complete` | `0` | `0` |

The user's `company_id` is needed for the detached default so that trade-partner editors don't get RLS-rejected by their own insert. The client either reads it from a small `useCurrentUser()` helper that caches the result, or stashes it on the bootstrap (plan-level call; the spec doesn't pre-decide).

### 6.2 Error handling matrix

| Failure | UI response | Recovery |
|---|---|---|
| RLS blocks insert/update | Toast: "You don't have permission to edit this task." | Rollback; no retry. |
| Network drop | Toast: "Couldn't reach server. Try again." | Rollback; user retries. |
| Auto-populate partial (lookahead inserted, tasks insert failed) | Toast: "Lookahead created but no tasks loaded — use Re-populate." | Empty-tasks state shows "Re-populate from master" button which calls a follow-up `useInsertLookaheadTask` batch. |
| Window dates invalid (start > end) | Inline form error; submit disabled | Client-side validation in the modal. |
| Master activity soft-deleted while editing its offsets | Toast: "Master activity was removed." Row's start/finish render "—". | Manual fix: pick a new master or detach. |
| Two browsers edit the same cell | Silent last-write-wins (no version column → no conflict toast). | Phase 6 realtime fixes. |

### 6.3 Soft-delete semantics

All delete mutations set `deleted_at = now()`. The Phase 4 read path (which filters by `deleted_at === null` in render code) already handles this correctly for both `lookaheads` and `lookahead_tasks`.

### 6.4 No history rows

Lookahead-task edits do **not** write to `activity_history`. The `activity_history` table stays a master-schedule-only log in v1. Field audit is deferred.

---

## 7. Testing Strategy

### 7.1 Unit tests (Vitest, jsdom where React)

| File | Coverage |
|---|---|
| `src/lib/state/mutations.lookahead.test.ts` | All 6 mutation hooks: optimistic update, rollback on error, RLS-rejection toast text. Follows the structure of Phase 4's `mutations.test.ts`. |
| `src/lib/state/auto-populate.test.ts` | The pure `mastersInWindow(bootstrap, indexed, windowStart, windowEnd)` selector — boundary cases (master starts before window and ends inside; fully inside; fully outside; summary/LOE excluded; deleted excluded; master with no engine result excluded). |
| `src/components/schedule/Lookahead/LookaheadTaskRow.test.tsx` | Click-to-edit, Enter commits, Esc reverts, blur commits; offset cells hidden for detached; date cells read-only when master-linked. |
| `src/components/schedule/Lookahead/NewLookaheadModal.test.tsx` | Form validation (start > end disables submit; required name); submit calls `useCreateLookahead` with the right args. |

### 7.2 Component-integration test (jsdom)

`src/components/schedule/Lookahead/LookaheadView.test.tsx` — render with a seeded bootstrap containing 2 master activities and 1 lookahead with 2 tasks (one offset-linked, one detached). Assert: dates resolve correctly, "+ Add Task" appears, Delete removes a row optimistically.

### 7.3 E2E test (Playwright, real Supabase)

`tests/e2e/lookahead-flow.spec.ts` — happy path as `scheduler@ihs.test`:

1. Navigate to project, switch to Lookahead view, see empty state.
2. Click "+ New Lookahead", fill name `"E2E Lookahead"`, window = today + 28 days, submit.
3. Modal closes, lookahead appears in dropdown, table populated with masters in window.
4. Edit one row's `% complete` cell inline, blur, assert value persists after page reload.
5. Click "+ Add Task", set master to "Detached", give it a name, save.
6. Delete that detached task, assert it disappears.
7. Delete the whole lookahead, assert dropdown returns to "Auto" preview.

### 7.4 Manual smoke

Like Phase 4's §7 walkthrough, the implementation plan ends with a "developer runs the dev server and clicks through" step before opening the PR — modal animation, focus management, dropdown UX, and offset-edit interactions that may not show up in tests.

### 7.5 Out of scope for v1 tests

- Concurrency / version-conflict tests (no version column → nothing to test).
- Carry-forward source mode (deferred).
- Rollup-to-master (deferred).
- Compare-to-master (deferred).
- External-user lookahead E2E (RLS already verified by Phase 4's external-user spec; revisit when rollup/compare land).

---

## 8. File Changes Summary

### New files

```
src/components/schedule/Lookahead/NewLookaheadModal.tsx
src/components/schedule/Lookahead/NewLookaheadModal.test.tsx
src/components/schedule/Lookahead/LookaheadTaskRow.tsx
src/components/schedule/Lookahead/LookaheadTaskRow.test.tsx
src/components/schedule/Lookahead/LookaheadView.test.tsx
src/lib/state/mutations.lookahead.test.ts
src/lib/state/auto-populate.ts            (pure mastersInWindow function)
src/lib/state/auto-populate.test.ts
tests/e2e/lookahead-flow.spec.ts
```

### Modified files

```
src/components/schedule/Lookahead/LookaheadView.tsx   (replace; add create/edit/delete affordances)
src/lib/state/mutations.ts                            (add 6 hooks)
```

### Unchanged

- All Phase 2 migrations.
- All Phase 4 engine, bootstrap, recalc, toast, query, ui-store, and non-lookahead component files.
- All Phase 3 server pipeline (still dormant).

---

## 9. Open Questions for the Implementation Plan

Items the spec deliberately leaves for the plan writer to resolve at task-granularity:

- Exact Tailwind / focus-trap pattern for the New Lookahead modal (no modal exists in Phase 4 to copy from).
- Exact dropdown shape for the master picker — a flat list of all live activities is fine for the seeded project (~10–20 activities); revisit if a real project gets to >100.
- Whether the "Re-populate from master" recovery button issues a new auto-populate against the current cache, or asks the user to confirm with the original window — recommend "current cache, original window" for simplicity.
- Whether the "+ Add Task" footer button opens an empty row immediately, or prompts the master-picker first — recommend "empty row immediately, master defaults to Detached, Name cell auto-focused in edit mode". Plan-level decision: does the row commit to the DB immediately on add, or only after the user types and blurs the Name cell? Recommend "commit immediately with defaults; user-edits are individual cell updates" — keeps the mutation model uniform.
- Exact order of columns in the table (the editable-cells table in §5.3 lists them, but final layout is a plan-level call).
