# Schedule CRUD + Engine Wiring — Design Spec (Phase 3)

> **Status:** Approved design. Implementation plan to follow via writing-plans.
> **Scope:** Phase 3 of the build roadmap in `docs/SCHEDULING-TOOL-PLAN.md` — the server-side
> write pipeline that lets clients edit a schedule and produces engine-computed dates
> atomically, plus a single bootstrap read endpoint.
> **Depends on:** Phase 1 (`feat/cpm-engine`) and Phase 2 (`feat/data-model`), both merged to
> `main` before implementation begins.
> **Date:** 2026-05-22

---

## 1. Scope & Decisions

**In scope (Phase 3):**

- Server route `POST /api/schedule/apply` — the `applyScheduleEdit` intent endpoint.
- Postgres function `apply_schedule_edit(jsonb) → jsonb` — single transactional boundary for
  every schedule-affecting write.
- Server route `GET /api/projects/:id/schedule` — single bootstrap read returning the full
  hydrated schedule (project, calendars, WBS, activities with computed dates, dependencies,
  constraints, resources, assignments).
- Plain CRUD endpoints for non-engine entities: `calendars`, `wbs_nodes`,
  `resources`, `resource_assignments`.
- Optimistic-concurrency `version` columns (integer) on `activities`, `dependencies`,
  `constraints`, `projects`, `calendars`, `wbs_nodes`, `resources`, `resource_assignments`.
- `applied_edit_requests` table for RPC idempotency.
- `projects.schedule_dirty_at` and `projects.last_engine_problems` columns.
- The Node-side pipeline that loads a snapshot, applies ops in memory, runs the engine,
  diffs for history, and submits the RPC payload — fully unit- and integration-tested.

**Out of scope (later phases):**

- External Trade Partner write paths — internal-only writes for Phase 3 (Phase 11).
- Realtime broadcast / multi-user reconciliation (Phase 6).
- Soft-lock / presence (Phase 6).
- Comments / activity feed reads (Phase 7). History rows are written; reading them is later.
- Baselines (Phase 10), Lookaheads (Phase 9), MPP/XER import (Phase 12).
- Hour-based scheduling, resource leveling.
- Any UI / Gantt rendering. Phase 3 ends at the API layer.

**Decisions locked during brainstorming:**

| Decision | Choice | Rationale |
|---|---|---|
| Section 3 mapping | **Phase 3 of build roadmap** (server CRUD + engine wiring) | The plan's Section 3 (engine) is already built; Phase 3 is the natural next step. |
| Branching | **Merge Phase 1 + Phase 2 to `main` before starting** | Cleanest history; Phase 3 only depends on merged code. |
| Entity write surface | **Activity + Dependency + Calendar + Constraint + WBS + Resource + Assignment, full CRUD** | Fuller scope keeps the API complete enough to feed Phase 4. |
| Transaction shape | **Single Postgres RPC commits the engine result** | One round trip, one tx; engine stays in JS, persistence in SQL. |
| Permission depth | **Internal-only writes for Phase 3** | RLS still blocks external users; external column rules wait for Phase 11. |
| Read path | **Hybrid: direct Supabase JS for most reads + one server bootstrap endpoint** | Smallest read surface; fastest app boot; RLS still enforced. |
| Pipeline shape | **Approach C — Hybrid**: `applyScheduleEdit` for engine-affecting ops, plain endpoints for non-engine CRUD | Matches plan §7.2–7.3; right transactional boundary. |
| Versioning | **Integer `version` column** | Monotonic, exact, no clock-skew issues. `updated_at` still written but not the concurrency token. |
| Cycle handling | **Cycles block the commit; negative float warns** | Cycle = engine can't produce dates; negative float = legitimate but infeasible state. |
| Idempotency | **`request_id` table** with unique `(project_id, request_id)` and a 24h TTL | Small cost; real correctness when a deploy retries. |
| History granularity | **One history row per changed field**, tagged `intent` vs `engine_cascade` | UI can collapse; losing granularity is irreversible. |
| Transaction isolation | **REPEATABLE READ** inside the RPC | Conservative; protects against future in-RPC reads. |
| Dirty-flag recovery | **Lazy** — recalc happens on next intent; manual `?recalc=true` escape hatch on the read endpoint | Avoids implicit recalc on every CRUD write. |

---

## 2. Architecture Overview

```
┌──────────────┐                                              ┌───────────────────────┐
│   Client     │  (1) intent ops[]                            │  Next.js route        │
│   (Phase 4+) │ ───────────────────────────────────────▶     │  /api/schedule/apply  │
└──────────────┘                                              └─────────┬─────────────┘
                                                                        │
                                  (2) read current project state        │
                                  via Supabase JS (service role)        │
                                       ▼                                │
                              ┌─────────────────────┐                   │
                              │ scheduleSnapshot    │                   │
                              │ (activities, deps,  │                   │
                              │  constraints,       │                   │
                              │  calendars, WBS,    │                   │
                              │  data_date)         │                   │
                              └──────────┬──────────┘                   │
                                         │                              │
                                         │ (3) apply ops in memory      │
                                         ▼                              │
                              ┌─────────────────────┐                   │
                              │ schedule-engine.    │  pure TS module   │
                              │ calculate(snapshot) │  (Phase 1)        │
                              └──────────┬──────────┘                   │
                                         │ ScheduleResult               │
                                         │ {activities[], problems[]}   │
                                         ▼                              │
                              ┌──────────────────────────────────┐      │
                              │ (4) one RPC commits the result   │      │
                              │     rpc('apply_schedule_edit',   │      │
                              │         payload)                  │◀─────┘
                              └─────────┬────────────────────────┘
                                        │  one Postgres tx:
                                        │   - version check per row
                                        │   - UPDATE activities (input + computed cols)
                                        │   - INSERT activity_history rows
                                        │   - bump activities.version, project.version
                                        ▼
                              ┌────────────────────┐
                              │   Postgres / RLS   │
                              └────────────────────┘
```

**Key properties:**

- **Engine runs in Node**, on the server route, against a fresh snapshot read inside the
  request. The browser may run the same engine optimistically for instant feedback in
  Phase 5; the server result is always authoritative.
- **One transactional boundary:** `apply_schedule_edit` PL/pgSQL function. The Node side
  never opens its own transaction.
- **Optimistic concurrency** lives in the RPC: each row write asserts
  `version = :base_version`; mismatch rolls back the whole tx and returns `STALE_STATE`.
- **Non-engine CRUD** (calendars, WBS, resources, assignments) uses plain endpoints under
  RLS — they don't run the engine on write, but they bump `projects.schedule_dirty_at`.
- **`getProjectSchedule(projectId)`** is the single bootstrap read endpoint; everything else
  reads directly from PostgREST under RLS.

---

## 3. The `apply_schedule_edit` RPC Contract

The load-bearing piece of Phase 3.

### 3.1 Split of work between Node and Postgres

The Node route owns the **engine and the history diff**; the RPC owns the
**persistence transaction**.

| Step | Where it runs | Why |
|---|---|---|
| Load snapshot (activities, dependencies, constraints, calendars, WBS, project) | Node — Supabase JS, service-role client scoped to project | Engine needs the full graph in memory. |
| Validate ops shapes (Zod) | Node | Fail-fast before any DB write. |
| Apply ops to in-memory snapshot | Node | Engine consumes `ScheduleInput`, not DB rows. |
| Run `engine.calculate(snapshot)` | Node | Engine is JS and only JS. |
| Compute history diff (intent rows + cascade rows) | Node | Requires comparing pre-engine vs post-engine. |
| Build the RPC payload | Node | — |
| Single RPC call with the full payload | Postgres | One transactional boundary. |
| Version checks + writes + history inserts + project patch | Postgres / PL/pgSQL | Atomic. |
| Engine-problem persistence + return shape | Postgres returns; Node serializes | — |

### 3.2 Function signature

```sql
create or replace function apply_schedule_edit(
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$ ... $$;
```

`SECURITY DEFINER` runs as a dedicated `schedule_writer` role so the function can write
across RLS — but the function **re-checks `has_capability`** itself, so this is not a
backdoor. `search_path` is fixed to prevent search-path-based privilege escalation
(per the Supabase hardening guidance).

Revoke `execute` from `public` and `anon`; grant only to `authenticated`.

### 3.3 Payload schema

```ts
type Payload = {
  project_id: uuid;
  edit_session_id: uuid;
  acting_user_id: uuid;
  request_id: uuid;              // for idempotency
  intent_op_count: int;
  base_versions: {
    project_version: int;
    activities:    Record<uuid, int>;   // every activity read by the engine
    dependencies:  Record<uuid, int>;
    constraints:   Record<uuid, int>;   // keyed by activity_id (1-per-activity for v1)
  };
  writes: {
    activity_inserts:        ActivityInsert[];
    activity_updates:        ActivityUpdate[];     // input cols AND computed cols
    activity_soft_deletes:   { id: uuid }[];
    dependency_inserts:      DependencyInsert[];
    dependency_updates:      DependencyUpdate[];
    dependency_soft_deletes: { id: uuid }[];
    constraint_upserts:      ConstraintUpsert[];
    constraint_deletes:      { activity_id: uuid }[];
    project_patch: { data_date?: date };
    project_problems: jsonb;
  };
  history_rows: HistoryRow[];
};

type HistoryRow = {
  entity:    'activity' | 'dependency' | 'constraint' | 'project';
  entity_id: uuid;
  field:     text;
  old_value: jsonb;
  new_value: jsonb;
  op_index:  int | null;        // null for engine cascades
  source:    'intent' | 'engine_cascade';
};
```

The RPC asserts:

- `acting_user_id = auth.uid()`.
- `intent_op_count` equals the number of distinct `op_index` values in `history_rows`.
- Every `entity_id` in `history_rows` appears in either `base_versions` (existing rows) or
  the corresponding `*_inserts` array (new rows).

### 3.4 Function body, step-by-step

```
1. AUTH
   - auth.uid() must be non-null  → else 'UNAUTHENTICATED' (PT001)
   - payload.acting_user_id = auth.uid() → else 'IDENTITY_MISMATCH' (PT002)
   - has_capability('edit_schedule', project_id) → else 'FORBIDDEN' (PT003)

2. IDEMPOTENCY  (upsert-then-lock pattern, race-safe)
   - INSERT INTO applied_edit_requests (project_id, request_id, response_blob, created_at)
       VALUES (?, ?, '{}'::jsonb, now())
       ON CONFLICT (project_id, request_id) DO NOTHING;
   - SELECT response_blob INTO v_existing FROM applied_edit_requests
       WHERE project_id = ? AND request_id = ?
       FOR UPDATE;
   - IF v_existing IS NOT NULL AND v_existing <> '{}'::jsonb THEN
       RETURN v_existing;     -- cached prior result, no further writes
     END IF;
   - Else: response_blob is '{}'::jsonb — either we just inserted the row, or a prior
     attempt died mid-RPC. Row is now locked for the rest of this tx. Proceed.

3. PAYLOAD SANITY  (sizes, history coverage — see 3.3)

4. VERSION CHECKS
   - For every id in base_versions.activities/dependencies/constraints, assert
     current DB version matches.
   - For project, assert version matches.
   - If any stale: build STALE_STATE response, UPDATE applied_edit_requests
     SET response_blob = <stale_response> WHERE request_id = ?, and RETURN.
     No other writes occur. The request row caches the stale response so a network
     retry with the same request_id deterministically returns the same answer; the
     client must mint a new request_id when retrying after refetch+reapply.

5. INSERTS  (activities → dependencies → constraints)
   - Each insert sets version = 1.
   - Collect (temp_id → new_uuid) into v_temp_id_map.

6. UPDATES  (activities, dependencies, constraints)
   - UPDATE sets new fields AND version = version + 1.

7. SOFT DELETES
   - UPDATE ... SET deleted_at = now(), version = version + 1.

8. PROJECT PATCH
   - UPDATE projects SET data_date = ?,
                         schedule_dirty_at = null,
                         last_engine_problems = writes.project_problems,
                         version = version + 1,
                         updated_at = now()
     WHERE id = project_id AND version = base_versions.project_version.

9. HISTORY ROWS
   - INSERT into activity_history (project_id, edit_session_id, acting_user_id,
                                    entity, entity_id, field, old_value, new_value,
                                    op_index, source, created_at).

10. WRITE RESPONSE BLOB
    - UPDATE applied_edit_requests SET response_blob = <result> WHERE request_id = ?.

11. RETURN
    - { ok: true, applied_at, project_version, activities, dependencies, constraints,
        project, temp_id_map, history_ids }
```

### 3.5 Engine cascades vs intent ops in `history_rows`

Every history row carries `source` and (for intents) `op_index`. The Node diff layer
produces them as:

- For each op in `ops[]`, emit history rows tagged `source='intent', op_index=i` for the
  **input-column** changes (duration, lag, constraint type, etc. — the literal field the
  user changed).
- After the engine runs, diff pre-engine vs post-engine **computed columns**
  (`planned_start`, `planned_finish`, `ES/EF/LS/LF`, `total_float`, `is_critical`) for every
  activity that changed. Each computed-column change emits one row tagged
  `source='engine_cascade', op_index=null`.

The side-panel feed (plan §2.4) will use this to render:

```
▸ Tanner — 4 changes (Edit session · May 22 2:14 PM)
   "Pour Slab"  duration  5d → 7d
   added FS dependency  Forms → Pour Slab  lag 0d
   +12 dependent activities recalculated   ← collapsed engine_cascade group
   Project finish  Jun 18 → Jun 20
```

### 3.6 Cycles and engine problems

| Engine problem | RPC behavior |
|---|---|
| **Cycle detected** | Engine refuses to produce dates. Node does NOT call the RPC; returns `{ ok:false, error:'ENGINE_CYCLE', cycle_path:[…] }`. Schedule unchanged. |
| **Constraint conflict producing negative float** | Engine returns dates + `problems[]` entry. Node calls the RPC normally; problems persisted on `projects.last_engine_problems`; response carries them so UI can warn. |
| **Open ends / unscheduled activities** | Allowed; `problems[]` notes them; commit proceeds. |
| **Validation failures pre-engine** | Node returns `VALIDATION_FAILED` with field-level errors; RPC not called. |

Only cycles block the write.

### 3.7 `STALE_STATE` response (no exception)

```jsonc
{
  "ok": false,
  "error": "STALE_STATE",
  "stale": {
    "activities":   ["uuid-a", "uuid-b"],
    "dependencies": ["uuid-c"],
    "constraints":  [],
    "project":      false
  }
}
```

Returned as a normal result (not raised) so the client can refetch and retry without
parsing SQLSTATE strings. The RPC builds it inside the same transaction before any writes;
the only write that happens is the `applied_edit_requests` row containing the stale-state
response (so a retry returns the same stale-state answer rather than re-running version
checks against new state).

### 3.8 Error-code catalog

| Code | Source | Meaning | Client action |
|---|---|---|---|
| `UNAUTHENTICATED` | RPC | `auth.uid()` is null | Re-auth |
| `IDENTITY_MISMATCH` | RPC | `acting_user_id` ≠ `auth.uid()` | Bug — report |
| `FORBIDDEN` | RPC | caller lacks `edit_schedule` capability | "No permission" |
| `VALIDATION_FAILED` | Node | op shape / cross-row pre-engine validation | Show field errors |
| `ENGINE_CYCLE` | Node | engine found a cycle; commit aborted | Show cycle UI |
| `STALE_STATE` | RPC | optimistic concurrency mismatch | Refetch + reapply + retry (new `request_id`) |
| `PAYLOAD_INVALID` | RPC | RPC-side payload assertions failed (history coverage, intent_op_count mismatch, etc.) | Bug — log + report |
| `INTERNAL` | RPC/Node | unexpected | Generic error; log |

Exported as a TypeScript discriminated union so callers handle all cases exhaustively.

### 3.9 Transaction isolation

`REPEATABLE READ` inside the RPC. The version-check pattern makes `READ COMMITTED`
correct in principle, but `REPEATABLE READ` is the conservative choice: if any future
change adds an in-RPC read, you get a stable snapshot for the duration of the call.

### 3.10 Idempotency

`applied_edit_requests` table:

```sql
create table applied_edit_requests (
  project_id    uuid    not null references projects(id) on delete cascade,
  request_id    uuid    not null,
  response_blob jsonb   not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  primary key (project_id, request_id)
);
create index on applied_edit_requests (created_at);
-- 24h TTL maintained by a daily cleanup (cron, scheduled function, or pg_cron) — not in
-- Phase 3 scope; the table tolerates growth until a follow-up housekeeping pass.
```

**Request_id lifetime.** A fresh `request_id` is minted **per submit attempt**, not per edit
session. The retry-after-network-timeout case (same submit attempt re-fired) keeps the same
`request_id` and gets the cached response. A retry-after-`STALE_STATE` (client refetched and
rebuilt the payload from new versions) is a *new attempt* — new `request_id`, new
response.

A retry with the same `request_id` returns the original `response_blob` and writes nothing
else.

### 3.11 Testing strategy for the RPC

- **Smoke**: empty `writes`, `intent_op_count = 0`, succeeds and returns current state.
- **Auth**: missing `auth.uid()`, mismatched `acting_user_id`, lacking capability — each
  raises the right error.
- **Stale state**: precondition a row's version forward by 1 between snapshot read and RPC;
  assert `STALE_STATE` with the right id in the payload and **no writes occurred** beyond
  the request-id row.
- **Atomic rollback**: inject a constraint violation in one of the writes (e.g., a
  soft-delete of a non-existent dependency) and assert nothing committed.
- **History rows**: assert `op_index` covers `[0..intent_op_count)` and every
  `engine_cascade` row has `op_index = null`.
- **Version bumps**: every updated row's `version` increments by exactly 1.
- **Idempotency**: replay the same `request_id`, assert the second call returns the
  original result and *no* new history rows.
- **Cycle path**: Node-side test — engine cycle short-circuits, RPC never called, DB
  unchanged.
- **Cascade visibility**: a single `setDuration` op produces N+1 history rows
  (1 intent + N cascades) and the activities response carries fresh computed columns.

---

## 4. Intent Op Catalog

`applyScheduleEdit` accepts an array of typed ops. Each op is a tagged-union with the
minimum fields needed to express the intent — no precomputed dates, no direct date writes.

| Op | Fields | What it does |
|---|---|---|
| `createActivity` | `tempId`, `wbsNodeId`, `name`, `activityType`, `originalDuration`, `calendarId?` | Insert a new activity. `tempId` lets the response map back to the persisted uuid. |
| `softDeleteActivity` | `activityId` | Marks `deleted_at`; engine input omits the activity and its dependencies. |
| `setActivityFields` | `activityId`, `patch: { name?, originalDuration?, remainingDuration?, wbsNodeId?, calendarId?, activityType?, responsiblePartyCompanyId? }` | Whitelisted-field patch. |
| `setProgress` | `activityId`, `percentComplete?`, `actualStart?`, `actualFinish?` | Progress + actuals; feeds the data-date logic. |
| `addDependency` | `tempId`, `predecessorId`, `successorId`, `relType` (FS/SS/FF/SF), `lag` | Creates a logic link. |
| `deactivateDependency` | `dependencyId` | Flip `is_active = false` (rendered dashed, ignored by engine). |
| `reactivateDependency` | `dependencyId` | Inverse. |
| `softDeleteDependency` | `dependencyId` | Permanent removal of the link (soft-deleted row preserved). |
| `setConstraint` | `activityId`, `type` (SNET/SNLT/FNET/FNLT/MSO/MFO/ALAP), `date?` | Upsert the activity's constraint. |
| `clearConstraint` | `activityId` | Remove the constraint. |
| `setProjectDataDate` | `dataDate` | Move the project's data date — re-forecast on remaining work. |

**No first-class `moveActivity` op.** Moving a bar means *adding/changing a constraint* (or
shifting `actual_start`); a direct date write would just be overwritten by the next engine
pass. `setConstraint` expresses moves explicitly.

**Validation happens twice:**
1. Per-op shape validation (Zod) before mutation.
2. Post-apply structural validation (no orphaned dependencies, durations ≥ 0, etc.) before
   engine call.

If any op fails validation, the whole batch is rejected — nothing is written.

---

## 5. Versioning & Concurrency

Integer `version` column on `activities`, `dependencies`, `constraints`, `projects`,
`calendars`, `wbs_nodes`, `resources`, `resource_assignments`. `updated_at` is still
written but is **not** the concurrency token.

**Read → edit → write flow:**

1. `getProjectSchedule(projectId)` returns every row's current `version`.
2. Client buffers ops during an Edit Mode session, keyed by the row versions it saw.
3. On submit, the route sends `base_versions` for **every row touched by any op, plus
   every row the engine reads** (predecessors of moved activities, all calendars referenced,
   etc. — the full snapshot footprint).
4. RPC asserts `current_version = base_version` for each. Mismatch → `STALE_STATE` for
   those ids; whole tx rolls back.

**Why version every row the engine reads, not just rows being written.** Engine results
depend on the full network. If user A drags Activity 42 while user B changes the duration
of predecessor 17, A's locally-computed dates for 42 are based on stale input. Catching it
in the RPC is what prevents silent cascade overwrites.

This is *optimistic* concurrency, not locking — Phase 6 adds advisory presence
("Tanner is editing") on top, but the source-of-truth conflict policy stays optimistic.

---

## 6. Plain CRUD Endpoints (Non-Engine Entities)

These mutate rows that don't change the engine result (or whose change is fine to be
picked up on the next recalc).

| Entity | Path | Notes |
|---|---|---|
| `calendars` | route handler `POST/PATCH/DELETE /api/calendars` | Validates calendar shape. Sets `projects.schedule_dirty_at`. Delete blocked if any activity references it. |
| `wbs_nodes` | route handler `POST/PATCH/DELETE /api/wbs-nodes` | Reparent checks for cycles. Soft-delete blocked if node has live children; cascade is an explicit opt-in. Bumps `schedule_dirty_at` only on reparent. |
| `resources` | direct Supabase JS under RLS | Plain CRUD; no engine impact in v1 (no leveling). |
| `resource_assignments` | direct Supabase JS under RLS | Same. |

**Common rules:**

- Every write touches `version` and `updated_at`.
- Every write writes a corresponding `activity_history` row (the audit table is general
  enough to capture all four entity types via discriminator).
- RLS policies from Phase 2 already gate these by `has_capability('manage_calendars' |
  'edit_schedule' | …)`. Phase 3 adds **no new RLS** — it just builds the endpoints that
  read/write through it.
- **No engine call on these writes.** `schedule_dirty_at` gets set on calendar /
  WBS-reparent changes; next `applyScheduleEdit` sees `dirty_at IS NOT NULL` and runs a
  full recalc as part of its batch.

**Dirty-flag policy: lazy.** Recalc happens on next intent. A future
`POST /api/schedule/recalculate` endpoint will let admins force a recalc, but it's not in
Phase 3.

---

## 7. The `getProjectSchedule` Read Endpoint

`GET /api/projects/:id/schedule` (Next.js route handler). Reads via the user's auth
context — RLS still gates it.

```ts
type ProjectSchedule = {
  project: {
    id, name, number, status,
    data_date, planned_start, planned_finish,
    version, schedule_dirty_at,
    last_engine_problems: EngineProblem[],
    default_calendar_id,
  };
  calendars:    Calendar[];
  wbs_nodes:    WbsNode[];          // tree-flat; client builds the tree
  activities:   ActivityWithComputed[];   // ES/EF/LS/LF, floats, is_critical, version
  dependencies: Dependency[];       // active + inactive
  constraints:  Constraint[];
  resources:    Resource[];
  resource_assignments: ResourceAssignment[];
  stale: boolean;                   // true if schedule_dirty_at is set
};
```

**Why one endpoint instead of six parallel PostgREST queries:**

- Single auth/RLS pass instead of six.
- Server can verify `version` consistency and set the `stale` flag.
- One place to evolve when the shape needs joins later.
- Cheap to cache per `(project_id, project_version)` in Phase 6 when realtime arrives.

**Optional `?recalc=true` flag.** If the caller has `edit_schedule` capability and the
flag is set, the endpoint triggers a recalc-only `applyScheduleEdit` (empty ops) before
responding. Off by default; intended as an admin escape hatch.

**No pagination in Phase 3.** Whole-project fetch. If a project grows past serverless
budget limits, the answer is server-side cursoring or a slice endpoint, deferred until
the pain is real.

---

## 8. Errors End-to-End

Every Phase 3 route returns one of:

```ts
{ ok: true, data: T }
| { ok: false, error: ErrorCode, details?: unknown }
```

Phase-3-specific codes layered on top of §3.8:

| Code | Where | When |
|---|---|---|
| `NOT_FOUND` | any GET | project / row doesn't exist or RLS denies |
| `BAD_REQUEST` | any POST/PATCH | malformed body |
| `CALENDAR_IN_USE` | calendar DELETE | activity references it |
| `WBS_HAS_CHILDREN` | WBS delete | live children block delete |
| `WBS_CYCLE` | WBS reparent | reparent would create a cycle |

**Engine problems are not errors.** A successful response with `last_engine_problems`
populated is the engine warning the user about an infeasible schedule.

**Logging.** Every `error !== STALE_STATE && error !== VALIDATION_FAILED` gets logged
server-side with `acting_user_id`, `project_id`, `request_id`, and structured details.

---

## 9. Testing Strategy

Three layers, mirroring the engine's tier approach.

**1. Unit (per-helper, no DB).**

- Op-shape Zod validators: each op type, each invalid case.
- The Node-side "diff" function that produces `history_rows` from pre-engine vs post-engine
  snapshots. Property test: every changed field corresponds to exactly one history row.
- The snapshot→engine-input mapper (DB rows → `ScheduleInput`).
- The temp-id resolver (createActivity/addDependency `tempId` → uuid).

**2. RPC integration (real Postgres, transactional fixture).**

The full list from §3.11. Runs against a local Supabase instance using the migration set
from Phase 2. Fixture seeds three users (internal scheduler, internal PM, internal viewer)
and a 4-activity project so each test starts from a known state. Concurrent-edit tests use
the scheduler + PM (both have `edit_schedule`); permission-denial tests use the viewer.

**3. End-to-end intent (Node route + RPC, no UI).**

Hits `/api/schedule/apply` over HTTP with a Supabase session token. One test per intent
op type, plus:

- Multi-op batch that exercises cascade.
- Concurrent edit: two clients submit overlapping ops; assert one wins, one gets
  `STALE_STATE`.
- `ENGINE_CYCLE`: submit ops that create a cycle; assert response shape and DB unchanged.
- Idempotency: replay same `request_id`; assert no-op + identical response.
- `getProjectSchedule` round-trip: apply edits, fetch, assert response matches engine
  output.

---

## 10. Code Structure

```
src/
  app/
    api/
      schedule/
        apply/route.ts             # POST  /api/schedule/apply
      projects/[id]/
        schedule/route.ts          # GET   /api/projects/:id/schedule
      calendars/route.ts           # POST/PATCH/DELETE
      wbs-nodes/route.ts           # POST/PATCH/DELETE
  lib/
    schedule-engine/               # Phase 1, UNCHANGED
    schedule-server/               # Phase 3
      apply-schedule-edit/
        index.ts                   # the route's pure pipeline function
        load-snapshot.ts           # DB rows → ScheduleInput
        apply-ops.ts               # mutates in-memory snapshot
        build-payload.ts           # diff + history rows + RPC payload
        validate.ts                # Zod schemas for every op + cross-row checks
        types.ts                   # IntentOp union, payload types, error union
        index.test.ts
      get-project-schedule/
        index.ts
        types.ts
      shared/
        errors.ts                  # ErrorCode union + helpers
        request-id.ts              # uuid generation + payload tagging
        rpc-client.ts              # typed wrapper over supabase.rpc('apply_schedule_edit')
supabase/
  migrations/
    YYYYMMDDHHMMSS_phase3_versions.sql        # version columns + indexes
    YYYYMMDDHHMMSS_phase3_project_fields.sql  # last_engine_problems, schedule_dirty_at
    YYYYMMDDHHMMSS_phase3_idempotency.sql     # applied_edit_requests table
    YYYYMMDDHHMMSS_phase3_rpc.sql             # apply_schedule_edit function + grants
  tests/
    apply_schedule_edit_test.sql              # SQL-level RPC tests
```

**Structural rules:**

- **`schedule-engine/` stays pure.** Phase 3 imports it; Phase 3 must not push DB types or
  async code into it.
- **Route files stay thin.** `app/api/.../route.ts` parses the request, calls into
  `lib/schedule-server/...`, serializes the result. No business logic in route files.

---

## 11. Open Decisions Resolved

| Plan-level open decision | Resolution in Phase 3 |
|---|---|
| §7.8 Direct client→Supabase reads vs server actions | **Hybrid**: direct for most reads, server for the bootstrap endpoint. |
| §7.8 Versioning field strategy | **Integer `version`**. |
| §7.8 Presence/soft-lock in v1 or v2 | **Deferred to Phase 6.** |
| §7.6 Engine problems block commit? | **Only cycles block; others warn.** |

---

## 12. Done When

Phase 3 is complete when:

1. `apply_schedule_edit` migration is applied; SQL-level tests pass.
2. `/api/schedule/apply` accepts every op type in §4, runs the engine, persists results,
   and returns the typed response shape from §3.
3. `/api/projects/:id/schedule` returns the full hydrated schedule with engine-computed
   dates.
4. Plain CRUD endpoints for calendars / WBS / resources / assignments work under RLS.
5. All three testing layers (§9) green.
6. A new activity + new dependency submitted via the API yields correct engine-computed
   `planned_start` / `planned_finish` persisted to the DB, with corresponding
   `activity_history` rows.

That last bullet is the plan's "Done when" check for Phase 3, verbatim.
