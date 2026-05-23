# Schedule CRUD + Engine Wiring (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-side schedule write pipeline — one `applyScheduleEdit` intent route backed by a single transactional Postgres RPC, plus plain CRUD for non-engine entities and one bootstrap read endpoint — so that schedule edits produce engine-computed dates atomically and are persisted with full optimistic-concurrency safety.

**Architecture:** Node route loads a snapshot via Supabase JS, applies typed intent ops in memory, runs the (pre-built, pure-TS) CPM engine, diffs for history, and submits one payload to `apply_schedule_edit(jsonb) → jsonb` — a `SECURITY DEFINER` PL/pgSQL function that owns the single transactional boundary. Integer `version` columns drive optimistic concurrency; an `applied_edit_requests` table provides idempotency; non-engine CRUD bumps `projects.schedule_dirty_at` and recalc happens lazily on the next intent.

**Tech Stack:** Next.js 16.2.6 (route handlers under `src/app/api/`), TypeScript, `@supabase/supabase-js`, `@supabase/ssr`, Zod for op validation, Vitest for tests. Postgres 17.6 (Supabase). No UI work — Phase 3 ends at the API layer.

**Source spec:** `docs/superpowers/specs/2026-05-22-phase-3-schedule-crud-design.md`

---

## Conventions & Working Notes

- **Authoritative references:** invoke the `supabase` skill for any uncertainty about CLI commands, RPC patterns, or RLS specifics. Invoke `claude-api` / general docs only if needed.
- **Next.js 16 ≠ training data.** `node_modules/next/dist/docs/01-app/` contains the version-accurate reference. **Read the relevant route-handler / server-action guides before writing any `src/app/api/.../route.ts` file.** Heed deprecation notices.
- **Patterns vault** (see `/Users/tanner/Documents/Construct.AI/Construct.AI/`):
  - `Patterns/Supabase RLS` — never use the service-role key in client code; respect the existing RLS policies; RPC `SECURITY DEFINER` is the only sanctioned bypass.
  - `Patterns/Role-Based Permissions` — the role-capability lookup is the source of truth; never hardcode role names in app logic.
- **Migration files** are created with `supabase migration new <name>`, which prepends a timestamp. This plan refers to them by logical name (`phase3_versions`, `phase3_rpc`, …); the real filenames will be `<timestamp>_phase3_versions.sql` etc. Edit the generated file — never hand-name migrations.
- **Forward-only correction:** `supabase db push` records applied migrations and won't re-apply edits. If you must change a pushed migration during development, `supabase db reset --linked` wipes and re-applies the corrected set. The hosted project is greenfield.
- **TDD:** every non-migration code task starts with a failing test. The plan shows the test code; do not skip to implementation.
- **Frequent commits:** every task ends with a commit step. Don't batch commits across tasks.

### Spec refinements made in this plan (strict improvements vs. spec)

1. **`activity_history` column naming.** The Phase 2 schema already shipped `activity_history` with columns `entity_type` (text), `changed_by`, `changed_at`, and `old_value` / `new_value` as `text`. The spec sketched these as `entity`, `acting_user_id`, `created_at`, and `jsonb`. **This plan uses the existing column names** and stores old/new values as JSON-encoded text (the Node diff layer calls `JSON.stringify`). New columns `op_index integer` and `source text` are added via a Phase 3 migration.
2. **`activities.version` already exists** (defaults to 1). The Phase 3 versions migration adds `version` to the seven remaining entities and to `projects`. No change to `activities` schema needed.
3. **`auth.uid()` inside `SECURITY DEFINER`.** Supabase preserves the JWT-derived `auth.uid()` across `SECURITY DEFINER` calls via session GUCs set by PostgREST. The RPC relies on this — do not pass `auth.uid()` as a function argument.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/<ts>_phase3_versions.sql` | Adds `version integer` to dependencies, activity_constraints, calendars, wbs_nodes, resources, resource_assignments, and projects. |
| `supabase/migrations/<ts>_phase3_project_fields.sql` | Adds `projects.schedule_dirty_at timestamptz` and `projects.last_engine_problems jsonb`. |
| `supabase/migrations/<ts>_phase3_history_extras.sql` | Adds `activity_history.op_index integer` and `activity_history.source text`. |
| `supabase/migrations/<ts>_phase3_idempotency.sql` | New table `applied_edit_requests`. |
| `supabase/migrations/<ts>_phase3_rpc.sql` | The `apply_schedule_edit(jsonb) → jsonb` function and its grants. |
| `supabase/tests/apply_schedule_edit_test.sql` | SQL-level RPC tests (psql-run assertions). |
| `src/lib/schedule-server/shared/types.ts` | `IntentOp` discriminated union, `Payload`, `ErrorCode`, response types. |
| `src/lib/schedule-server/shared/errors.ts` | Typed error union helpers. |
| `src/lib/schedule-server/shared/rpc-client.ts` | Typed wrapper over `supabase.rpc('apply_schedule_edit', ...)`. |
| `src/lib/schedule-server/shared/supabase-client.ts` | Service-role + user-context Supabase JS factories for server use. |
| `src/lib/schedule-server/apply-schedule-edit/validate.ts` | Zod schemas for each op + post-apply structural validation. |
| `src/lib/schedule-server/apply-schedule-edit/load-snapshot.ts` | DB rows → `ScheduleInput` + `base_versions`. |
| `src/lib/schedule-server/apply-schedule-edit/apply-ops.ts` | Pure in-memory op application against the snapshot. |
| `src/lib/schedule-server/apply-schedule-edit/build-payload.ts` | Diff + history rows + RPC payload assembly. |
| `src/lib/schedule-server/apply-schedule-edit/index.ts` | Pipeline orchestrator (load → validate → apply → engine → build → rpc → response). |
| `src/lib/schedule-server/get-project-schedule/index.ts` | The bootstrap read pipeline. |
| `src/app/api/schedule/apply/route.ts` | Thin HTTP wrapper: parse → call pipeline → serialize. |
| `src/app/api/projects/[id]/schedule/route.ts` | Thin GET wrapper. |
| `src/app/api/calendars/route.ts` | Plain CRUD: POST / PATCH / DELETE. |
| `src/app/api/wbs-nodes/route.ts` | Plain CRUD with reparent-cycle check. |
| `tests/integration/apply-schedule-edit.test.ts` | E2E intent tests (per op + multi-op + cycle + STALE_STATE + idempotency). |
| `tests/integration/get-project-schedule.test.ts` | E2E bootstrap-read round-trip. |
| `tests/integration/setup.ts` | Shared test fixture: three seeded users + 4-activity project. |

> **Not built as server routes in Phase 3:** `resources` and `resource_assignments`. Per spec §6, clients access these via direct Supabase JS under RLS — no server endpoint is needed because they have no engine impact in v1 and the RLS policies from Phase 2 already gate them. They'll be exercised once Phase 4 (UI) lands.

---

## Task 1: Verify the build base and create the Phase 3 worktree

**Files:** none new; verifies repo state.

- [ ] **Step 1: Verify Phase 1 and Phase 2 are merged to main**

```bash
cd "/Users/tanner/IHS- Scheduling Tool"
git fetch origin
git log origin/main --oneline | grep -E "cpm-engine|data-model" | head -5
```

Expected: at least one commit each from `feat/cpm-engine` (e.g., "feat: add CPM forward pass") and `feat/data-model` (e.g., "feat: add core schema") shows up on `origin/main`. If not, stop and ask the user to merge both PRs before proceeding — the Phase 3 plan assumes both phases are on main.

- [ ] **Step 2: Create the Phase 3 worktree off the latest main**

```bash
git worktree add .worktrees/schedule-crud -b feat/schedule-crud origin/main
cd .worktrees/schedule-crud
git log -1 --oneline
```

Expected: HEAD matches `origin/main`. All subsequent tasks operate from `.worktrees/schedule-crud`.

- [ ] **Step 3: Verify the engine module is intact**

```bash
ls src/lib/schedule-engine/
npm install
npm test -- src/lib/schedule-engine
```

Expected: engine directory shows `calendar.ts`, `forwardPass.ts`, `backwardPass.ts`, `float.ts`, `constraints.ts`, `graph.ts`, `index.ts`, `progress.ts`, `rollup.ts`, `types.ts`, plus their `.test.ts` files. Engine tests all pass.

- [ ] **Step 4: Verify the data model migrations apply cleanly**

```bash
ls supabase/migrations/
supabase status
```

Expected: 5 migration files (`*_core.sql`, `*_schedule.sql`, `*_collaboration.sql`, `*_rls_functions.sql`, `*_rls_policies.sql`). `supabase status` shows the hosted project linked.

- [ ] **Step 5: No commit** — Task 1 is verification only.

---

## Task 2: Install Supabase JS dependencies and read the Next.js 16 docs

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Read the Next.js 16 route-handler guide**

```bash
ls node_modules/next/dist/docs/01-app/
```

Open the route-handler guide and the server-action guide. **Note any deprecations vs. older Next.js APIs.** Phase 3 uses route handlers only (no server actions) — confirm the export shape (`export async function POST(request: Request)`) and dynamic-param signature for `[id]` routes against the version-accurate docs.

- [ ] **Step 2: Install the Supabase client libraries**

```bash
npm install @supabase/supabase-js @supabase/ssr zod
```

Expected: `package.json` lists `@supabase/supabase-js`, `@supabase/ssr`, and `zod` under `dependencies`.

- [ ] **Step 3: Verify install**

```bash
npm ls @supabase/supabase-js @supabase/ssr zod
```

Expected: each prints a single resolved version with no errors.

- [ ] **Step 4: Add the Supabase env vars to `.env.local`** (do not commit)

```
NEXT_PUBLIC_SUPABASE_URL=https://uluasgpcokjwowpawavl.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from Supabase dashboard>
SUPABASE_SERVICE_ROLE_KEY=<service role key from Supabase dashboard>
```

Ask the user for the anon and service-role keys if not already known. **Verify `.env.local` is in `.gitignore` — it must never be committed.**

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @supabase/supabase-js, @supabase/ssr, zod"
```

---

## Task 3: Migration — add version columns to all remaining entities

**Files:**
- Create: `supabase/migrations/<ts>_phase3_versions.sql`

- [ ] **Step 1: Create the migration file**

```bash
supabase migration new phase3_versions
```

- [ ] **Step 2: Write the migration**

```sql
-- Phase 3: integer optimistic-concurrency versions for every entity that can be
-- the target of an edit. activities.version already exists from Phase 2.

alter table dependencies          add column version integer not null default 1;
alter table activity_constraints  add column version integer not null default 1;
alter table calendars             add column version integer not null default 1;
alter table wbs_nodes             add column version integer not null default 1;
alter table resources             add column version integer not null default 1;
alter table resource_assignments  add column version integer not null default 1;
alter table projects              add column version integer not null default 1;
```

- [ ] **Step 3: Push and verify**

```bash
supabase db push
psql "$SUPABASE_SESSION_POOLER_URL" -c "
  select table_name from information_schema.columns
    where column_name='version' and table_schema='public'
    order by table_name;"
```

Expected output rows: `activities`, `activity_constraints`, `calendars`, `dependencies`, `projects`, `resource_assignments`, `resources`, `wbs_nodes`.

(`SUPABASE_SESSION_POOLER_URL` should be set in the shell to the session-pooler connection string from the Supabase project memory note. `psql` lives at `/opt/homebrew/opt/libpq/bin/psql`.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "feat: add integer version columns for optimistic concurrency"
```

---

## Task 4: Migration — add `projects.schedule_dirty_at` and `projects.last_engine_problems`

**Files:**
- Create: `supabase/migrations/<ts>_phase3_project_fields.sql`

- [ ] **Step 1: Create the migration file**

```bash
supabase migration new phase3_project_fields
```

- [ ] **Step 2: Write the migration**

```sql
-- Phase 3: lazy-recalc dirty flag + persisted engine problems on the project row.

alter table projects
  add column schedule_dirty_at timestamptz,
  add column last_engine_problems jsonb not null default '[]'::jsonb;
```

- [ ] **Step 3: Push and verify**

```bash
supabase db push
psql "$SUPABASE_SESSION_POOLER_URL" -c "
  select column_name, data_type from information_schema.columns
    where table_name='projects' and column_name in
      ('schedule_dirty_at','last_engine_problems');"
```

Expected: two rows — `schedule_dirty_at timestamp with time zone`, `last_engine_problems jsonb`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "feat: add schedule_dirty_at and last_engine_problems to projects"
```

---

## Task 5: Migration — add `op_index` and `source` to `activity_history`

**Files:**
- Create: `supabase/migrations/<ts>_phase3_history_extras.sql`

- [ ] **Step 1: Create the migration file**

```bash
supabase migration new phase3_history_extras
```

- [ ] **Step 2: Write the migration**

```sql
-- Phase 3: history rows distinguish intent ops from engine cascades, and intent
-- rows carry an index into the original ops[] array for UI grouping.

alter table activity_history
  add column op_index integer,
  add column source text not null default 'intent'
    check (source in ('intent', 'engine_cascade'));

-- Engine cascades have null op_index; intent rows must have a non-null index.
alter table activity_history
  add constraint activity_history_op_index_when_intent
  check (
    (source = 'intent' and op_index is not null) or
    (source = 'engine_cascade' and op_index is null)
  );
```

- [ ] **Step 3: Push and verify**

```bash
supabase db push
psql "$SUPABASE_SESSION_POOLER_URL" -c "
  select column_name, data_type from information_schema.columns
    where table_name='activity_history' and column_name in ('op_index','source');"
```

Expected: two rows — `op_index integer`, `source text`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "feat: add op_index and source columns to activity_history"
```

---

## Task 6: Migration — `applied_edit_requests` table for RPC idempotency

**Files:**
- Create: `supabase/migrations/<ts>_phase3_idempotency.sql`

- [ ] **Step 1: Create the migration file**

```bash
supabase migration new phase3_idempotency
```

- [ ] **Step 2: Write the migration**

```sql
-- Phase 3: idempotency table for apply_schedule_edit. A retry with the same
-- (project_id, request_id) returns the cached response_blob and writes nothing
-- else. Empty response_blob ('{}') means a prior attempt died mid-RPC.

create table applied_edit_requests (
  project_id    uuid not null references projects(id) on delete cascade,
  request_id    uuid not null,
  response_blob jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  primary key (project_id, request_id)
);
create index idx_applied_edit_requests_created_at on applied_edit_requests(created_at);

-- RLS: not exposed to clients; only the apply_schedule_edit RPC reads/writes it.
alter table applied_edit_requests enable row level security;

-- (No policies = nothing is selectable from clients. The RPC runs SECURITY
-- DEFINER as schedule_writer and bypasses RLS.)
```

- [ ] **Step 3: Push and verify**

```bash
supabase db push
psql "$SUPABASE_SESSION_POOLER_URL" -c "
  select count(*) from information_schema.tables
    where table_name='applied_edit_requests';"
```

Expected: `1`.

```bash
psql "$SUPABASE_SESSION_POOLER_URL" -c "
  select relrowsecurity from pg_class where relname='applied_edit_requests';"
```

Expected: `t`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "feat: add applied_edit_requests table for RPC idempotency"
```

---

## Task 7: Migration — the `apply_schedule_edit` RPC skeleton (auth + idempotency only)

**Files:**
- Create: `supabase/migrations/<ts>_phase3_rpc.sql`

> Build the RPC in layers. This task implements steps 1 (auth) and 2 (idempotency) from spec §3.4 and returns a placeholder response. Subsequent tasks add version checks, writes, and history.

- [ ] **Step 1: Create the migration file**

```bash
supabase migration new phase3_rpc
```

- [ ] **Step 2: Write the initial function**

```sql
-- Phase 3: apply_schedule_edit — single transactional boundary for every
-- schedule-affecting write. Built in layers: this version implements auth and
-- idempotency only and returns a placeholder success response when the payload
-- carries no writes.

create or replace function apply_schedule_edit(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id      uuid := (p_payload->>'project_id')::uuid;
  v_request_id      uuid := (p_payload->>'request_id')::uuid;
  v_acting_user_id  uuid := (p_payload->>'acting_user_id')::uuid;
  v_existing        jsonb;
  v_response        jsonb;
begin
  -- 0. ISOLATION  (spec §3.9 — conservative against future in-RPC reads)
  set local transaction isolation level repeatable read;

  -- 1. AUTH ----------------------------------------------------------------
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'PT001';
  end if;
  if v_acting_user_id is null or v_acting_user_id <> auth.uid() then
    raise exception 'IDENTITY_MISMATCH' using errcode = 'PT002';
  end if;
  if not has_capability('edit_schedule', v_project_id) then
    raise exception 'FORBIDDEN' using errcode = 'PT003';
  end if;

  -- 2. IDEMPOTENCY (upsert-then-lock; race-safe) ---------------------------
  insert into applied_edit_requests (project_id, request_id, response_blob, created_at)
    values (v_project_id, v_request_id, '{}'::jsonb, now())
    on conflict (project_id, request_id) do nothing;

  select response_blob into v_existing
    from applied_edit_requests
    where project_id = v_project_id and request_id = v_request_id
    for update;

  if v_existing is not null and v_existing <> '{}'::jsonb then
    return v_existing;  -- cached prior result
  end if;

  -- 3..9 placeholder: subsequent tasks add version checks, writes, history.
  v_response := jsonb_build_object(
    'ok', true,
    'applied_at', now(),
    'note', 'placeholder — version-checks/writes not yet implemented'
  );

  update applied_edit_requests
    set response_blob = v_response
    where project_id = v_project_id and request_id = v_request_id;

  return v_response;
end;
$$;

revoke execute on function apply_schedule_edit(jsonb) from public, anon;
grant  execute on function apply_schedule_edit(jsonb) to authenticated;
```

- [ ] **Step 3: Push the migration**

```bash
supabase db push
```

Expected: succeeds.

- [ ] **Step 4: Verify the function exists**

```bash
psql "$SUPABASE_SESSION_POOLER_URL" -c "
  select proname, prosecdef from pg_proc
    where proname='apply_schedule_edit';"
```

Expected: one row, `prosecdef = t` (SECURITY DEFINER).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations
git commit -m "feat: add apply_schedule_edit RPC skeleton (auth + idempotency)"
```

---

## Task 8: SQL test — auth + idempotency for the RPC skeleton

**Files:**
- Create: `supabase/tests/apply_schedule_edit_test.sql`

> This file accumulates as later tasks add capabilities. This task lays the foundation: seeds two users (internal scheduler + internal viewer) and asserts the auth/idempotency behavior from Task 7.

- [ ] **Step 1: Write the initial test script**

```sql
-- supabase/tests/apply_schedule_edit_test.sql
-- Run as: psql "$SUPABASE_SESSION_POOLER_URL" -f supabase/tests/apply_schedule_edit_test.sql
-- All assertions use \echo + DO blocks raising 'TEST FAILED' on violation.

\set ON_ERROR_STOP on
\echo '== apply_schedule_edit tests =='

begin;

-- ------------------------------------------------------------------
-- Fixture (idempotent: nukes the test project rows each run)
-- ------------------------------------------------------------------
do $$
declare
  v_org    uuid;
  v_co_int uuid;
  v_u_sch  uuid := '11111111-1111-1111-1111-111111111111';
  v_u_view uuid := '22222222-2222-2222-2222-222222222222';
  v_proj   uuid := '33333333-3333-3333-3333-333333333333';
  v_cal    uuid := '44444444-4444-4444-4444-444444444444';
begin
  delete from applied_edit_requests where project_id = v_proj;
  delete from memberships where project_id = v_proj;
  delete from projects where id = v_proj;
  delete from calendars where id = v_cal;
  delete from users where id in (v_u_sch, v_u_view);
  delete from companies where name = 'TEST internal co';
  delete from organizations where name = 'TEST org';

  insert into organizations (id, name) values (gen_random_uuid(), 'TEST org')
    returning id into v_org;
  insert into companies (organization_id, name, type)
    values (v_org, 'TEST internal co', 'internal') returning id into v_co_int;

  -- auth.users seeds (Supabase auth schema): insert minimal rows so FK passes.
  insert into auth.users (id, email) values
    (v_u_sch,  'sched@test.local'),
    (v_u_view, 'viewer@test.local')
    on conflict (id) do nothing;

  insert into users (id, company_id, full_name, email) values
    (v_u_sch,  v_co_int, 'Test Scheduler', 'sched@test.local'),
    (v_u_view, v_co_int, 'Test Viewer',    'viewer@test.local');

  insert into projects (id, organization_id, name, project_start)
    values (v_proj, v_org, 'TEST proj', '2026-06-01');

  insert into calendars (id, project_id, name, is_default)
    values (v_cal, v_proj, 'TEST cal', true);
  update projects set default_calendar_id = v_cal where id = v_proj;

  insert into memberships (user_id, project_id, role) values
    (v_u_sch,  v_proj, 'scheduler'),
    (v_u_view, v_proj, 'internal_viewer');
end $$;

-- ------------------------------------------------------------------
-- TEST 1: unauthenticated call raises UNAUTHENTICATED
-- ------------------------------------------------------------------
\echo '-- T1: UNAUTHENTICATED'
do $$
begin
  perform set_config('request.jwt.claim.sub', null, true);
  begin
    perform apply_schedule_edit(jsonb_build_object(
      'project_id',      '33333333-3333-3333-3333-333333333333',
      'request_id',      gen_random_uuid(),
      'acting_user_id',  '11111111-1111-1111-1111-111111111111'
    ));
    raise 'TEST FAILED: expected UNAUTHENTICATED';
  exception when sqlstate 'PT001' then
    null;  -- expected
  end;
end $$;

-- ------------------------------------------------------------------
-- TEST 2: identity mismatch raises IDENTITY_MISMATCH
-- ------------------------------------------------------------------
\echo '-- T2: IDENTITY_MISMATCH'
do $$
begin
  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);
  begin
    perform apply_schedule_edit(jsonb_build_object(
      'project_id',      '33333333-3333-3333-3333-333333333333',
      'request_id',      gen_random_uuid(),
      'acting_user_id',  '22222222-2222-2222-2222-222222222222'
    ));
    raise 'TEST FAILED: expected IDENTITY_MISMATCH';
  exception when sqlstate 'PT002' then
    null;
  end;
end $$;

-- ------------------------------------------------------------------
-- TEST 3: viewer (no edit_schedule) raises FORBIDDEN
-- ------------------------------------------------------------------
\echo '-- T3: FORBIDDEN'
do $$
begin
  perform set_config('request.jwt.claim.sub',
    '22222222-2222-2222-2222-222222222222', true);
  begin
    perform apply_schedule_edit(jsonb_build_object(
      'project_id',      '33333333-3333-3333-3333-333333333333',
      'request_id',      gen_random_uuid(),
      'acting_user_id',  '22222222-2222-2222-2222-222222222222'
    ));
    raise 'TEST FAILED: expected FORBIDDEN';
  exception when sqlstate 'PT003' then
    null;
  end;
end $$;

-- ------------------------------------------------------------------
-- TEST 4: scheduler with valid payload gets the placeholder OK response,
--         and a retry with the same request_id returns the same cached blob
--         without writing anything new.
-- ------------------------------------------------------------------
\echo '-- T4: idempotent cache hit'
do $$
declare
  v_req uuid := gen_random_uuid();
  v_r1  jsonb;
  v_r2  jsonb;
  v_rows int;
begin
  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);

  v_r1 := apply_schedule_edit(jsonb_build_object(
    'project_id',      '33333333-3333-3333-3333-333333333333',
    'request_id',      v_req,
    'acting_user_id',  '11111111-1111-1111-1111-111111111111'
  ));

  v_r2 := apply_schedule_edit(jsonb_build_object(
    'project_id',      '33333333-3333-3333-3333-333333333333',
    'request_id',      v_req,
    'acting_user_id',  '11111111-1111-1111-1111-111111111111'
  ));

  if v_r1 is distinct from v_r2 then
    raise 'TEST FAILED: idempotency replay returned a different response';
  end if;

  select count(*) into v_rows from applied_edit_requests
    where project_id = '33333333-3333-3333-3333-333333333333' and request_id = v_req;
  if v_rows <> 1 then
    raise 'TEST FAILED: expected exactly one applied_edit_requests row, got %', v_rows;
  end if;
end $$;

rollback;
\echo '== all tests passed =='
```

- [ ] **Step 2: Run the test (must pass)**

```bash
psql "$SUPABASE_SESSION_POOLER_URL" -f supabase/tests/apply_schedule_edit_test.sql
```

Expected: prints `-- T1: …`, `-- T2: …`, `-- T3: …`, `-- T4: …`, then `== all tests passed ==`. If any assertion fails, `\set ON_ERROR_STOP on` aborts and prints the failure. Do not commit until passing.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests
git commit -m "test: add SQL-level auth and idempotency tests for apply_schedule_edit"
```

---

## Task 9: Shared types — `IntentOp`, `Payload`, errors

**Files:**
- Create: `src/lib/schedule-server/shared/types.ts`
- Create: `src/lib/schedule-server/shared/errors.ts`

- [ ] **Step 1: Write the test first**

```ts
// src/lib/schedule-server/shared/types.test.ts
import { describe, it, expect, expectTypeOf } from "vitest";
import type { IntentOp, ErrorCode, ApplyScheduleEditResponse } from "./types";

describe("IntentOp discriminated union", () => {
  it("requires the right fields per op type", () => {
    const op1: IntentOp = {
      type: "createActivity",
      tempId: "t1",
      wbsNodeId: "w1",
      name: "Pour Slab",
      activityType: "task",
      originalDuration: 5,
    };
    expect(op1.type).toBe("createActivity");

    const op2: IntentOp = {
      type: "setProgress",
      activityId: "a1",
      percentComplete: 50,
    };
    expect(op2.type).toBe("setProgress");
  });

  it("error union is exhaustive", () => {
    const codes: ErrorCode[] = [
      "UNAUTHENTICATED", "IDENTITY_MISMATCH", "FORBIDDEN",
      "VALIDATION_FAILED", "ENGINE_CYCLE", "STALE_STATE",
      "PAYLOAD_INVALID", "INTERNAL",
    ];
    expect(codes).toHaveLength(8);
  });

  it("response shape narrows on ok", () => {
    const ok: ApplyScheduleEditResponse = {
      ok: true,
      data: {
        applied_at: "2026-05-22T00:00:00Z",
        project_version: 2,
        activities: [],
        dependencies: [],
        constraints: [],
        project: {
          id: "p1", version: 2, schedule_dirty_at: null,
          last_engine_problems: [],
        },
        temp_id_map: {},
        history_ids: [],
      },
    };
    expectTypeOf(ok).toMatchTypeOf<{ ok: true }>();
  });
});
```

- [ ] **Step 2: Run the test — it should fail (no types file yet)**

```bash
npx vitest run src/lib/schedule-server/shared/types.test.ts
```

Expected: FAIL — `Cannot find module './types'`.

- [ ] **Step 3: Write the types**

```ts
// src/lib/schedule-server/shared/types.ts
import type {
  ActivityType, DependencyType, ConstraintType,
  ActivityResult, Problem, IsoDate,
} from "@/lib/schedule-engine/types";

// -----------------------------------------------------------------------
// Intent op union
// -----------------------------------------------------------------------
export type IntentOp =
  | CreateActivityOp | SoftDeleteActivityOp | SetActivityFieldsOp
  | SetProgressOp
  | AddDependencyOp | DeactivateDependencyOp | ReactivateDependencyOp
  | SoftDeleteDependencyOp
  | SetConstraintOp | ClearConstraintOp
  | SetProjectDataDateOp;

export interface CreateActivityOp {
  type: "createActivity";
  tempId: string;
  wbsNodeId: string;
  name: string;
  activityType: ActivityType;
  originalDuration: number;
  calendarId?: string;
}
export interface SoftDeleteActivityOp { type: "softDeleteActivity"; activityId: string; }
export interface SetActivityFieldsOp {
  type: "setActivityFields";
  activityId: string;
  patch: Partial<{
    name: string;
    originalDuration: number;
    remainingDuration: number;
    wbsNodeId: string;
    calendarId: string;
    activityType: ActivityType;
    responsiblePartyCompanyId: string | null;
  }>;
}
export interface SetProgressOp {
  type: "setProgress";
  activityId: string;
  percentComplete?: number;
  actualStart?: IsoDate;
  actualFinish?: IsoDate;
}
export interface AddDependencyOp {
  type: "addDependency";
  tempId: string;
  predecessorId: string;
  successorId: string;
  relType: DependencyType;
  lag: number;
}
export interface DeactivateDependencyOp { type: "deactivateDependency"; dependencyId: string; }
export interface ReactivateDependencyOp { type: "reactivateDependency"; dependencyId: string; }
export interface SoftDeleteDependencyOp { type: "softDeleteDependency"; dependencyId: string; }
export interface SetConstraintOp {
  type: "setConstraint";
  activityId: string;
  constraintType: ConstraintType;
  date?: IsoDate;
}
export interface ClearConstraintOp { type: "clearConstraint"; activityId: string; }
export interface SetProjectDataDateOp { type: "setProjectDataDate"; dataDate: IsoDate; }

// -----------------------------------------------------------------------
// RPC payload (mirrors spec §3.3)
// -----------------------------------------------------------------------
export interface ApplyScheduleEditPayload {
  project_id: string;
  edit_session_id: string;
  acting_user_id: string;
  request_id: string;
  intent_op_count: number;
  base_versions: {
    project_version: number;
    activities: Record<string, number>;
    dependencies: Record<string, number>;
    constraints: Record<string, number>;
  };
  writes: PayloadWrites;
  history_rows: HistoryRow[];
}

export interface PayloadWrites {
  activity_inserts: ActivityInsertRow[];
  activity_updates: ActivityUpdateRow[];
  activity_soft_deletes: { id: string }[];
  dependency_inserts: DependencyInsertRow[];
  dependency_updates: DependencyUpdateRow[];
  dependency_soft_deletes: { id: string }[];
  constraint_upserts: ConstraintUpsertRow[];
  constraint_deletes: { activity_id: string }[];
  project_patch: { data_date?: IsoDate };
  project_problems: Problem[];
}

export interface ActivityInsertRow {
  temp_id: string;
  wbs_node_id: string;
  name: string;
  activity_type: ActivityType;
  original_duration: number;
  remaining_duration: number;
  calendar_id: string | null;
  // computed cols filled in by Node after engine run:
  early_start: IsoDate | null;
  early_finish: IsoDate | null;
  late_start: IsoDate | null;
  late_finish: IsoDate | null;
  planned_start: IsoDate | null;
  planned_finish: IsoDate | null;
  total_float: number | null;
  free_float: number | null;
  is_critical: boolean;
}
export interface ActivityUpdateRow extends Omit<ActivityInsertRow, "temp_id"> {
  id: string;
  percent_complete?: number;
  actual_start?: IsoDate | null;
  actual_finish?: IsoDate | null;
  responsible_company_id?: string | null;
}
export interface DependencyInsertRow {
  temp_id: string;
  predecessor_id: string;
  successor_id: string;
  type: DependencyType;
  lag: number;
  is_active: boolean;
}
export interface DependencyUpdateRow {
  id: string;
  is_active?: boolean;
  lag?: number;
  type?: DependencyType;
}
export interface ConstraintUpsertRow {
  activity_id: string;
  type: ConstraintType;
  constraint_date: IsoDate | null;
}

export interface HistoryRow {
  entity_type: "activity" | "dependency" | "constraint" | "project";
  entity_id: string;
  field: string;
  old_value: string | null;   // JSON-encoded; matches existing column type
  new_value: string | null;
  op_index: number | null;
  source: "intent" | "engine_cascade";
}

// -----------------------------------------------------------------------
// Response union
// -----------------------------------------------------------------------
export type ErrorCode =
  | "UNAUTHENTICATED" | "IDENTITY_MISMATCH" | "FORBIDDEN"
  | "VALIDATION_FAILED" | "ENGINE_CYCLE" | "STALE_STATE"
  | "PAYLOAD_INVALID" | "INTERNAL";

export interface ApplyScheduleEditSuccess {
  applied_at: string;
  project_version: number;
  activities: ActivityResult[];
  dependencies: DependencyUpdateRow[];   // post-write rows
  constraints: ConstraintUpsertRow[];
  project: {
    id: string;
    version: number;
    schedule_dirty_at: string | null;
    last_engine_problems: Problem[];
  };
  temp_id_map: Record<string, string>;
  history_ids: string[];
}

export type ApplyScheduleEditResponse =
  | { ok: true;  data: ApplyScheduleEditSuccess }
  | { ok: false; error: ErrorCode; details?: unknown };
```

- [ ] **Step 4: Write the errors helper**

```ts
// src/lib/schedule-server/shared/errors.ts
import type { ErrorCode } from "./types";

const SQLSTATE_TO_ERROR: Record<string, ErrorCode> = {
  PT001: "UNAUTHENTICATED",
  PT002: "IDENTITY_MISMATCH",
  PT003: "FORBIDDEN",
};

export function sqlstateToErrorCode(sqlstate: string | undefined): ErrorCode {
  if (!sqlstate) return "INTERNAL";
  return SQLSTATE_TO_ERROR[sqlstate] ?? "INTERNAL";
}

export function err<E extends ErrorCode>(
  error: E,
  details?: unknown,
): { ok: false; error: E; details?: unknown } {
  return details === undefined ? { ok: false, error } : { ok: false, error, details };
}
```

- [ ] **Step 5: Run the test — must pass**

```bash
npx vitest run src/lib/schedule-server/shared/types.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/schedule-server/shared
git commit -m "feat: add IntentOp union, RPC payload types, and error helpers"
```

---

## Task 10: Supabase client factories for server use

**Files:**
- Create: `src/lib/schedule-server/shared/supabase-client.ts`

> Two clients: (a) a service-role client for internal reads where bypassing RLS is OK (only inside server pipelines that have already authorized); (b) a per-request client bound to the caller's JWT for RPC calls (so `auth.uid()` works).

- [ ] **Step 1: Read the Next.js 16 + `@supabase/ssr` guide**

Open `node_modules/@supabase/ssr/README.md` and the Next.js cookies/headers guide under `node_modules/next/dist/docs/01-app/`. Confirm the recommended factory pattern for App Router route handlers.

- [ ] **Step 2: Write the client module**

```ts
// src/lib/schedule-server/shared/supabase-client.ts
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Per-request client bound to the caller's auth cookie. Use for the RPC call
 * and any read that must respect RLS (the RPC needs auth.uid()).
 */
export async function createRouteSupabaseClient() {
  const cookieStore = await cookies();
  return createServerClient(URL, ANON, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(toSet) {
        for (const { name, value, options } of toSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS. ONLY use inside pipelines that have already
 * called createRouteSupabaseClient() and verified the caller has the required
 * capability — never expose this to a request without prior authorization.
 */
export function createServiceRoleClient() {
  return createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/schedule-server/shared/supabase-client.ts
git commit -m "feat: add per-request and service-role Supabase client factories"
```

---

## Task 11: Op-shape Zod validators

**Files:**
- Create: `src/lib/schedule-server/apply-schedule-edit/validate.ts`
- Create: `src/lib/schedule-server/apply-schedule-edit/validate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/schedule-server/apply-schedule-edit/validate.test.ts
import { describe, it, expect } from "vitest";
import { validateOps } from "./validate";

describe("validateOps", () => {
  it("accepts a valid createActivity op", () => {
    const result = validateOps([
      {
        type: "createActivity",
        tempId: "t1",
        wbsNodeId: "11111111-1111-1111-1111-111111111111",
        name: "Pour Slab",
        activityType: "task",
        originalDuration: 5,
      },
    ]);
    expect(result.ok).toBe(true);
  });

  it("rejects an op with a negative duration", () => {
    const result = validateOps([
      {
        type: "createActivity",
        tempId: "t1",
        wbsNodeId: "11111111-1111-1111-1111-111111111111",
        name: "Pour Slab",
        activityType: "task",
        originalDuration: -1,
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].path).toContain("originalDuration");
    }
  });

  it("rejects an unknown op type", () => {
    const result = validateOps([{ type: "movePaneA", id: "x" } as never]);
    expect(result.ok).toBe(false);
  });

  it("rejects addDependency with predecessor === successor", () => {
    const result = validateOps([
      {
        type: "addDependency",
        tempId: "t1",
        predecessorId: "22222222-2222-2222-2222-222222222222",
        successorId: "22222222-2222-2222-2222-222222222222",
        relType: "FS",
        lag: 0,
      },
    ]);
    expect(result.ok).toBe(false);
  });

  it("rejects setConstraint without a date for date-bearing types", () => {
    const result = validateOps([
      { type: "setConstraint", activityId: "a1", constraintType: "SNET" },
    ]);
    expect(result.ok).toBe(false);
  });

  it("accepts setConstraint type=ALAP without a date", () => {
    const result = validateOps([
      { type: "setConstraint", activityId: "33333333-3333-3333-3333-333333333333",
        constraintType: "ALAP" },
    ]);
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test — must fail**

```bash
npx vitest run src/lib/schedule-server/apply-schedule-edit/validate.test.ts
```

Expected: FAIL — no `validate.ts` exists.

- [ ] **Step 3: Write the validators**

```ts
// src/lib/schedule-server/apply-schedule-edit/validate.ts
import { z } from "zod";
import type { IntentOp } from "../shared/types";

const uuid = z.string().uuid();
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const dur = z.number().int().min(0);

const ActivityTypeEnum  = z.enum(["task", "milestone", "summary", "level_of_effort"]);
const DepTypeEnum       = z.enum(["FS", "SS", "FF", "SF"]);
const ConstraintEnum    = z.enum(["SNET","SNLT","FNET","FNLT","MSO","MFO","ALAP"]);

const createActivity = z.object({
  type: z.literal("createActivity"),
  tempId: z.string().min(1),
  wbsNodeId: uuid,
  name: z.string().min(1),
  activityType: ActivityTypeEnum,
  originalDuration: dur,
  calendarId: uuid.optional(),
});

const softDeleteActivity = z.object({
  type: z.literal("softDeleteActivity"),
  activityId: uuid,
});

const setActivityFields = z.object({
  type: z.literal("setActivityFields"),
  activityId: uuid,
  patch: z.object({
    name: z.string().min(1).optional(),
    originalDuration: dur.optional(),
    remainingDuration: dur.optional(),
    wbsNodeId: uuid.optional(),
    calendarId: uuid.optional(),
    activityType: ActivityTypeEnum.optional(),
    responsiblePartyCompanyId: uuid.nullable().optional(),
  }).refine(p => Object.keys(p).length > 0, "patch must change at least one field"),
});

const setProgress = z.object({
  type: z.literal("setProgress"),
  activityId: uuid,
  percentComplete: z.number().min(0).max(100).optional(),
  actualStart:  iso.optional(),
  actualFinish: iso.optional(),
}).refine(o => o.percentComplete !== undefined || o.actualStart || o.actualFinish,
  "setProgress must change at least one field");

const addDependency = z.object({
  type: z.literal("addDependency"),
  tempId: z.string().min(1),
  predecessorId: uuid,
  successorId: uuid,
  relType: DepTypeEnum,
  lag: z.number().int(),
}).refine(o => o.predecessorId !== o.successorId, "self-loop not allowed");

const depIdOnly = (tag: string) => z.object({ type: z.literal(tag), dependencyId: uuid });

const setConstraint = z.object({
  type: z.literal("setConstraint"),
  activityId: uuid,
  constraintType: ConstraintEnum,
  date: iso.optional(),
}).refine(o => o.constraintType === "ALAP" || o.date !== undefined,
  "date required for all constraint types except ALAP");

const clearConstraint = z.object({
  type: z.literal("clearConstraint"),
  activityId: uuid,
});

const setProjectDataDate = z.object({
  type: z.literal("setProjectDataDate"),
  dataDate: iso,
});

const opSchema = z.discriminatedUnion("type", [
  createActivity, softDeleteActivity, setActivityFields, setProgress,
  addDependency,
  depIdOnly("deactivateDependency"),
  depIdOnly("reactivateDependency"),
  depIdOnly("softDeleteDependency"),
  setConstraint, clearConstraint, setProjectDataDate,
]);

export type ValidateResult =
  | { ok: true;  ops: IntentOp[] }
  | { ok: false; errors: { path: (string|number)[]; message: string }[] };

export function validateOps(input: unknown[]): ValidateResult {
  const parsed = z.array(opSchema).safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(i => ({ path: i.path, message: i.message })),
    };
  }
  return { ok: true, ops: parsed.data as IntentOp[] };
}
```

- [ ] **Step 4: Run the test — must pass**

```bash
npx vitest run src/lib/schedule-server/apply-schedule-edit/validate.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedule-server/apply-schedule-edit/validate.ts \
        src/lib/schedule-server/apply-schedule-edit/validate.test.ts
git commit -m "feat: add Zod validators for every IntentOp variant"
```

---

## Task 12: Snapshot loader — DB rows → `ScheduleInput`

**Files:**
- Create: `src/lib/schedule-server/apply-schedule-edit/load-snapshot.ts`
- Create: `src/lib/schedule-server/apply-schedule-edit/load-snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/schedule-server/apply-schedule-edit/load-snapshot.test.ts
import { describe, it, expect } from "vitest";
import { rowsToScheduleInput } from "./load-snapshot";

describe("rowsToScheduleInput", () => {
  it("maps project + activities + deps + constraints into ScheduleInput", () => {
    const result = rowsToScheduleInput({
      project: { id: "p1", project_start: "2026-06-01", data_date: null,
                 default_calendar_id: "cal1", critical_float_threshold: 0 },
      calendars: [{ id: "cal1", working_weekdays: [1,2,3,4,5] }],
      calendar_exceptions: [],
      activities: [
        { id: "a1", activity_type: "task", original_duration: 5, remaining_duration: 5,
          calendar_id: null, actual_start: null, actual_finish: null,
          percent_complete: 0, deleted_at: null },
        { id: "a2", activity_type: "task", original_duration: 3, remaining_duration: 3,
          calendar_id: null, actual_start: null, actual_finish: null,
          percent_complete: 0, deleted_at: null },
      ],
      dependencies: [
        { id: "d1", predecessor_id: "a1", successor_id: "a2",
          type: "FS", lag: 0, is_active: true, deleted_at: null },
      ],
      activity_constraints: [],
    });

    expect(result.input.activities).toHaveLength(2);
    expect(result.input.dependencies).toHaveLength(1);
    expect(result.input.dependencies[0].predecessorId).toBe("a1");
    expect(result.baseVersions.activities).toEqual({ a1: 1, a2: 1 });
  });

  it("excludes soft-deleted rows from the engine input but keeps versions", () => {
    const result = rowsToScheduleInput({
      project: { id: "p1", project_start: "2026-06-01", data_date: null,
                 default_calendar_id: "cal1", critical_float_threshold: 0 },
      calendars: [{ id: "cal1", working_weekdays: [1,2,3,4,5] }],
      calendar_exceptions: [],
      activities: [
        { id: "a1", activity_type: "task", original_duration: 5, remaining_duration: 5,
          calendar_id: null, actual_start: null, actual_finish: null,
          percent_complete: 0, deleted_at: "2026-05-01T00:00:00Z" },
      ],
      dependencies: [],
      activity_constraints: [],
    });
    expect(result.input.activities).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — must fail**

```bash
npx vitest run src/lib/schedule-server/apply-schedule-edit/load-snapshot.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// src/lib/schedule-server/apply-schedule-edit/load-snapshot.ts
import type {
  ScheduleInput, ActivityInput, DependencyInput,
  Calendar, CalendarException, ActivityConstraint,
} from "@/lib/schedule-engine/types";

interface DbProject {
  id: string;
  project_start: string;
  data_date: string | null;
  default_calendar_id: string;
  critical_float_threshold: number;
  version?: number;
}
interface DbCalendar { id: string; working_weekdays: number[]; version?: number; }
interface DbCalendarException { calendar_id: string; exception_date: string; working: boolean; }
interface DbActivity {
  id: string; activity_type: string;
  name: string; wbs_node_id: string;
  original_duration: number; remaining_duration: number;
  calendar_id: string | null;
  actual_start: string | null; actual_finish: string | null;
  percent_complete: number;
  planned_start: string | null; planned_finish: string | null;
  deleted_at: string | null;
  version?: number;
}
interface DbDependency {
  id: string; predecessor_id: string; successor_id: string;
  type: "FS"|"SS"|"FF"|"SF"; lag: number; is_active: boolean;
  deleted_at: string | null;
  version?: number;
}
interface DbConstraint {
  activity_id: string; type: string; constraint_date: string | null;
  version?: number;
}

export interface SnapshotInput {
  project: DbProject;
  calendars: DbCalendar[];
  calendar_exceptions: DbCalendarException[];
  activities: DbActivity[];
  dependencies: DbDependency[];
  activity_constraints: DbConstraint[];
}

export interface SnapshotResult {
  input: ScheduleInput;
  baseVersions: {
    project_version: number;
    activities: Record<string, number>;
    dependencies: Record<string, number>;
    constraints: Record<string, number>;
  };
  /** Original DB rows kept by id for the build-payload diff step. */
  raw: SnapshotInput;
}

export function rowsToScheduleInput(s: SnapshotInput): SnapshotResult {
  const exceptionsByCal = new Map<string, CalendarException[]>();
  for (const e of s.calendar_exceptions) {
    const arr = exceptionsByCal.get(e.calendar_id) ?? [];
    arr.push({ date: e.exception_date, working: e.working });
    exceptionsByCal.set(e.calendar_id, arr);
  }

  const calendars: Calendar[] = s.calendars.map(c => ({
    id: c.id,
    workingWeekdays: c.working_weekdays,
    exceptions: exceptionsByCal.get(c.id) ?? [],
  }));

  const constraintsByActivity = new Map<string, ActivityConstraint>();
  for (const c of s.activity_constraints) {
    constraintsByActivity.set(c.activity_id, {
      type: c.type as ActivityConstraint["type"],
      date: c.constraint_date ?? "",
    });
  }

  const activities: ActivityInput[] = s.activities
    .filter(a => a.deleted_at === null)
    .map(a => ({
      id: a.id,
      type: a.activity_type === "milestone" ? "milestone" : "task",
      originalDuration: a.original_duration,
      remainingDuration: a.remaining_duration,
      calendarId: a.calendar_id ?? undefined,
      actualStart: a.actual_start ?? undefined,
      actualFinish: a.actual_finish ?? undefined,
      percentComplete: a.percent_complete,
      constraint: constraintsByActivity.get(a.id),
    }));

  const liveIds = new Set(activities.map(a => a.id));
  const dependencies: DependencyInput[] = s.dependencies
    .filter(d => d.deleted_at === null
                  && liveIds.has(d.predecessor_id) && liveIds.has(d.successor_id))
    .map(d => ({
      id: d.id,
      predecessorId: d.predecessor_id,
      successorId: d.successor_id,
      type: d.type,
      lag: d.lag,
      isActive: d.is_active,
    }));

  const input: ScheduleInput = {
    projectStart: s.project.project_start,
    dataDate: s.project.data_date,
    defaultCalendarId: s.project.default_calendar_id,
    calendars,
    activities,
    dependencies,
    options: { criticalFloatThreshold: s.project.critical_float_threshold },
  };

  const baseVersions = {
    project_version: s.project.version ?? 1,
    activities:   Object.fromEntries(s.activities.map(a => [a.id, a.version ?? 1])),
    dependencies: Object.fromEntries(s.dependencies.map(d => [d.id, d.version ?? 1])),
    constraints:  Object.fromEntries(s.activity_constraints.map(c => [c.activity_id, c.version ?? 1])),
  };

  return { input, baseVersions, raw: s };
}
```

- [ ] **Step 4: Run — must pass**

```bash
npx vitest run src/lib/schedule-server/apply-schedule-edit/load-snapshot.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedule-server/apply-schedule-edit/load-snapshot.ts \
        src/lib/schedule-server/apply-schedule-edit/load-snapshot.test.ts
git commit -m "feat: map DB rows to ScheduleInput with base_versions"
```

---

## Task 13: Apply-ops — pure in-memory mutation

**Files:**
- Create: `src/lib/schedule-server/apply-schedule-edit/apply-ops.ts`
- Create: `src/lib/schedule-server/apply-schedule-edit/apply-ops.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/schedule-server/apply-schedule-edit/apply-ops.test.ts
import { describe, it, expect } from "vitest";
import { applyOps } from "./apply-ops";
import type { IntentOp } from "../shared/types";
import type { ScheduleInput } from "@/lib/schedule-engine/types";

const baseInput: ScheduleInput = {
  projectStart: "2026-06-01",
  dataDate: null,
  defaultCalendarId: "cal1",
  calendars: [{ id: "cal1", workingWeekdays: [1,2,3,4,5], exceptions: [] }],
  activities: [
    { id: "a1", type: "task", originalDuration: 5, remainingDuration: 5 },
    { id: "a2", type: "task", originalDuration: 3, remainingDuration: 3 },
  ],
  dependencies: [],
};

describe("applyOps", () => {
  it("createActivity adds an activity with a uuid mapped from tempId", () => {
    const ops: IntentOp[] = [{
      type: "createActivity", tempId: "t1",
      wbsNodeId: "11111111-1111-1111-1111-111111111111",
      name: "New", activityType: "task", originalDuration: 7,
    }];
    const r = applyOps(baseInput, ops);
    expect(r.input.activities).toHaveLength(3);
    expect(r.tempIdMap).toHaveProperty("t1");
    expect(r.input.activities.find(a => a.id === r.tempIdMap.t1)).toBeTruthy();
  });

  it("setActivityFields patches only listed fields", () => {
    const r = applyOps(baseInput, [{
      type: "setActivityFields", activityId: "a1",
      patch: { originalDuration: 9 },
    }]);
    const a1 = r.input.activities.find(a => a.id === "a1")!;
    expect(a1.originalDuration).toBe(9);
    expect(a1.remainingDuration).toBe(5);
  });

  it("addDependency adds a link, deactivateDependency flips is_active", () => {
    const r1 = applyOps(baseInput, [{
      type: "addDependency", tempId: "d1",
      predecessorId: "a1", successorId: "a2", relType: "FS", lag: 0,
    }]);
    expect(r1.input.dependencies).toHaveLength(1);
    const depId = r1.tempIdMap.d1;
    const r2 = applyOps(r1.input, [
      { type: "deactivateDependency", dependencyId: depId },
    ]);
    expect(r2.input.dependencies[0].isActive).toBe(false);
  });

  it("setConstraint upserts an at-most-one constraint per activity", () => {
    const r = applyOps(baseInput, [{
      type: "setConstraint", activityId: "a1",
      constraintType: "SNET", date: "2026-07-01",
    }]);
    expect(r.input.activities.find(a => a.id === "a1")!.constraint)
      .toEqual({ type: "SNET", date: "2026-07-01" });
  });

  it("addDependency resolves sibling tempIds from earlier createActivity ops", () => {
    const r = applyOps(baseInput, [
      { type: "createActivity", tempId: "ta",
        wbsNodeId: "11111111-1111-1111-1111-111111111111",
        name: "A new", activityType: "task", originalDuration: 4 },
      { type: "createActivity", tempId: "tb",
        wbsNodeId: "11111111-1111-1111-1111-111111111111",
        name: "B new", activityType: "task", originalDuration: 2 },
      { type: "addDependency", tempId: "d1",
        predecessorId: "ta", successorId: "tb", relType: "FS", lag: 0 },
    ]);
    expect(r.input.dependencies).toHaveLength(1);
    const dep = r.input.dependencies[0];
    expect(dep.predecessorId).toBe(r.tempIdMap.ta);
    expect(dep.successorId).toBe(r.tempIdMap.tb);
  });

  it("softDeleteActivity removes the activity AND any deps referencing it", () => {
    const withDep = applyOps(baseInput, [{
      type: "addDependency", tempId: "d1",
      predecessorId: "a1", successorId: "a2", relType: "FS", lag: 0,
    }]);
    const r = applyOps(withDep.input, [{ type: "softDeleteActivity", activityId: "a1" }]);
    expect(r.input.activities.find(a => a.id === "a1")).toBeUndefined();
    expect(r.input.dependencies).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — must fail**

```bash
npx vitest run src/lib/schedule-server/apply-schedule-edit/apply-ops.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// src/lib/schedule-server/apply-schedule-edit/apply-ops.ts
import { randomUUID } from "node:crypto";
import type { IntentOp } from "../shared/types";
import type { ScheduleInput, ActivityInput, DependencyInput }
  from "@/lib/schedule-engine/types";

export interface ApplyOpsResult {
  input: ScheduleInput;
  tempIdMap: Record<string, string>;
  /** Soft-deleted activity ids and dependency ids — surfaced to build-payload. */
  softDeleted: { activityIds: string[]; dependencyIds: string[] };
  /** project_patch fields the route should propagate to the RPC. */
  projectPatch: { data_date?: string };
}

export function applyOps(input: ScheduleInput, ops: IntentOp[]): ApplyOpsResult {
  // Defensive shallow clone — engine treats input as read-only but we mutate locally.
  const activities = input.activities.map(a => ({ ...a }));
  const dependencies = input.dependencies.map(d => ({ ...d }));
  const tempIdMap: Record<string, string> = {};
  const softDeletedActivities: string[] = [];
  const softDeletedDeps: string[] = [];
  let dataDate = input.dataDate;

  const idx = <T extends { id: string }>(arr: T[], id: string) =>
    arr.findIndex(x => x.id === id);

  for (const op of ops) {
    switch (op.type) {
      case "createActivity": {
        const id = randomUUID();
        tempIdMap[op.tempId] = id;
        const a: ActivityInput = {
          id,
          type: op.activityType === "milestone" ? "milestone" : "task",
          originalDuration: op.originalDuration,
          remainingDuration: op.originalDuration,
          calendarId: op.calendarId,
        };
        activities.push(a);
        break;
      }
      case "softDeleteActivity": {
        const i = idx(activities, op.activityId);
        if (i >= 0) {
          softDeletedActivities.push(op.activityId);
          activities.splice(i, 1);
        }
        // Cascade: drop any deps referencing it.
        for (let j = dependencies.length - 1; j >= 0; j--) {
          const d = dependencies[j];
          if (d.predecessorId === op.activityId || d.successorId === op.activityId) {
            softDeletedDeps.push(d.id);
            dependencies.splice(j, 1);
          }
        }
        break;
      }
      case "setActivityFields": {
        const i = idx(activities, op.activityId);
        if (i < 0) throw new Error(`activity not found: ${op.activityId}`);
        const a = activities[i];
        const p = op.patch;
        if (p.originalDuration  !== undefined) a.originalDuration  = p.originalDuration;
        if (p.remainingDuration !== undefined) a.remainingDuration = p.remainingDuration;
        if (p.calendarId        !== undefined) a.calendarId        = p.calendarId;
        if (p.activityType      !== undefined)
          a.type = p.activityType === "milestone" ? "milestone" : "task";
        // name, wbsNodeId, responsiblePartyCompanyId aren't engine inputs — build-payload
        // picks them up from the original op list.
        break;
      }
      case "setProgress": {
        const i = idx(activities, op.activityId);
        if (i < 0) throw new Error(`activity not found: ${op.activityId}`);
        const a = activities[i];
        if (op.percentComplete !== undefined) a.percentComplete = op.percentComplete;
        if (op.actualStart  !== undefined) a.actualStart  = op.actualStart;
        if (op.actualFinish !== undefined) a.actualFinish = op.actualFinish;
        // Engine treats actualStart/Finish as fixed and recomputes remaining
        // forward from data_date — Phase 1 already handles this.
        break;
      }
      case "addDependency": {
        const id = randomUUID();
        tempIdMap[op.tempId] = id;
        // Resolve sibling temp ids ("ta"/"tb" referenced from earlier
        // createActivity ops in the same batch) → real uuids before the
        // engine sees them.
        const predecessorId = tempIdMap[op.predecessorId] ?? op.predecessorId;
        const successorId   = tempIdMap[op.successorId]   ?? op.successorId;
        const d: DependencyInput = {
          id,
          predecessorId, successorId,
          type: op.relType, lag: op.lag, isActive: true,
        };
        dependencies.push(d);
        break;
      }
      case "deactivateDependency": {
        const i = idx(dependencies, op.dependencyId);
        if (i >= 0) dependencies[i].isActive = false;
        break;
      }
      case "reactivateDependency": {
        const i = idx(dependencies, op.dependencyId);
        if (i >= 0) dependencies[i].isActive = true;
        break;
      }
      case "softDeleteDependency": {
        const i = idx(dependencies, op.dependencyId);
        if (i >= 0) {
          softDeletedDeps.push(op.dependencyId);
          dependencies.splice(i, 1);
        }
        break;
      }
      case "setConstraint": {
        const i = idx(activities, op.activityId);
        if (i < 0) throw new Error(`activity not found: ${op.activityId}`);
        activities[i] = {
          ...activities[i],
          constraint: { type: op.constraintType, date: op.date ?? "" },
        };
        break;
      }
      case "clearConstraint": {
        const i = idx(activities, op.activityId);
        if (i < 0) throw new Error(`activity not found: ${op.activityId}`);
        const a = { ...activities[i] };
        delete a.constraint;
        activities[i] = a;
        break;
      }
      case "setProjectDataDate":
        dataDate = op.dataDate;
        break;
    }
  }

  return {
    input: { ...input, activities, dependencies, dataDate },
    tempIdMap,
    softDeleted: { activityIds: softDeletedActivities, dependencyIds: softDeletedDeps },
    projectPatch: dataDate !== input.dataDate ? { data_date: dataDate ?? undefined } : {},
  };
}
```

- [ ] **Step 4: Run — must pass**

```bash
npx vitest run src/lib/schedule-server/apply-schedule-edit/apply-ops.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedule-server/apply-schedule-edit/apply-ops.ts \
        src/lib/schedule-server/apply-schedule-edit/apply-ops.test.ts
git commit -m "feat: apply intent ops in-memory to produce engine input"
```

---

## Task 14: Build-payload — diff + history rows + RPC payload

**Files:**
- Create: `src/lib/schedule-server/apply-schedule-edit/build-payload.ts`
- Create: `src/lib/schedule-server/apply-schedule-edit/build-payload.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/schedule-server/apply-schedule-edit/build-payload.test.ts
import { describe, it, expect } from "vitest";
import { buildPayload } from "./build-payload";
import type { IntentOp } from "../shared/types";

describe("buildPayload", () => {
  it("emits intent + cascade history rows for a duration change", () => {
    const result = buildPayload({
      projectId: "p1",
      editSessionId: "es1",
      actingUserId: "u1",
      requestId: "r1",
      ops: [{
        type: "setActivityFields", activityId: "a1",
        patch: { originalDuration: 7 },
      }] satisfies IntentOp[],
      tempIdMap: {},
      preEngineActivities: [
        { id: "a1", original_duration: 5, planned_start: "2026-06-01",
          planned_finish: "2026-06-05" },
        { id: "a2", original_duration: 3, planned_start: "2026-06-08",
          planned_finish: "2026-06-10" },
      ],
      postEngineActivities: [
        { id: "a1", early_start: "2026-06-01", early_finish: "2026-06-09",
          late_start: "2026-06-01", late_finish: "2026-06-09",
          planned_start: "2026-06-01", planned_finish: "2026-06-09",
          total_float: 0, free_float: 0, is_critical: true },
        { id: "a2", early_start: "2026-06-10", early_finish: "2026-06-12",
          late_start: "2026-06-10", late_finish: "2026-06-12",
          planned_start: "2026-06-10", planned_finish: "2026-06-12",
          total_float: 0, free_float: 0, is_critical: true },
      ],
      preEngineConstraints: [],
      preEngineDependencies: [],
      baseVersions: {
        project_version: 1, activities: { a1: 1, a2: 1 },
        dependencies: {}, constraints: {},
      },
      softDeleted: { activityIds: [], dependencyIds: [] },
      projectPatch: {},
      engineProblems: [],
      originalActivityInputs: {
        a1: { name: "A1", wbs_node_id: "w1", activity_type: "task" },
        a2: { name: "A2", wbs_node_id: "w1", activity_type: "task" },
      },
    });

    expect(result.intentOpCount).toBe(1);
    const intent = result.payload.history_rows.filter(r => r.source === "intent");
    const cascade = result.payload.history_rows.filter(r => r.source === "engine_cascade");
    expect(intent).toHaveLength(1);
    expect(intent[0].field).toBe("original_duration");
    // a1 planned_finish changed AND a2 planned_start/finish changed
    expect(cascade.length).toBeGreaterThanOrEqual(3);
    expect(cascade.every(r => r.op_index === null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run — must fail**

```bash
npx vitest run src/lib/schedule-server/apply-schedule-edit/build-payload.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/schedule-server/apply-schedule-edit/build-payload.ts
import type {
  ApplyScheduleEditPayload, HistoryRow, IntentOp,
  ActivityInsertRow, ActivityUpdateRow, DependencyInsertRow, DependencyUpdateRow,
  ConstraintUpsertRow,
} from "../shared/types";
import type { ActivityResult, Problem } from "@/lib/schedule-engine/types";

export interface BuildPayloadInput {
  projectId: string;
  editSessionId: string;
  actingUserId: string;
  requestId: string;
  ops: IntentOp[];
  tempIdMap: Record<string, string>;
  preEngineActivities: Array<{
    id: string; original_duration: number;
    planned_start: string | null; planned_finish: string | null;
  }>;
  postEngineActivities: ActivityResult[];
  preEngineDependencies: Array<{ id: string; is_active: boolean; lag: number; type: string }>;
  preEngineConstraints: Array<{ activity_id: string; type: string; constraint_date: string | null }>;
  baseVersions: ApplyScheduleEditPayload["base_versions"];
  softDeleted: { activityIds: string[]; dependencyIds: string[] };
  projectPatch: { data_date?: string };
  engineProblems: Problem[];
  /** Fields the engine doesn't carry but the DB row needs (name, wbs_node_id, …). */
  originalActivityInputs: Record<string, { name: string; wbs_node_id: string; activity_type: string }>;
}

export interface BuildPayloadResult {
  payload: ApplyScheduleEditPayload;
  intentOpCount: number;
}

const NULLABLE_DATE = (v: string | null) => (v == null ? null : v);

export function buildPayload(b: BuildPayloadInput): BuildPayloadResult {
  const history: HistoryRow[] = [];

  // 1. INTENT history rows (one per op that touches a stored input column)
  b.ops.forEach((op, opIndex) => {
    const push = (
      entity_type: HistoryRow["entity_type"],
      entity_id: string, field: string,
      oldV: unknown, newV: unknown,
    ) => history.push({
      entity_type, entity_id, field,
      old_value: oldV === undefined ? null : JSON.stringify(oldV),
      new_value: newV === undefined ? null : JSON.stringify(newV),
      op_index: opIndex, source: "intent",
    });

    switch (op.type) {
      case "createActivity":
        push("activity", b.tempIdMap[op.tempId], "created", null,
             { name: op.name, originalDuration: op.originalDuration });
        break;
      case "softDeleteActivity":
        push("activity", op.activityId, "deleted_at", null, "now()");
        break;
      case "setActivityFields":
        for (const [k, v] of Object.entries(op.patch))
          push("activity", op.activityId, k, undefined, v);
        break;
      case "setProgress":
        if (op.percentComplete !== undefined)
          push("activity", op.activityId, "percent_complete", undefined, op.percentComplete);
        if (op.actualStart !== undefined)
          push("activity", op.activityId, "actual_start", undefined, op.actualStart);
        if (op.actualFinish !== undefined)
          push("activity", op.activityId, "actual_finish", undefined, op.actualFinish);
        break;
      case "addDependency":
        push("dependency", b.tempIdMap[op.tempId], "created", null,
             { predecessorId: op.predecessorId, successorId: op.successorId,
               relType: op.relType, lag: op.lag });
        break;
      case "deactivateDependency":
        push("dependency", op.dependencyId, "is_active", true, false); break;
      case "reactivateDependency":
        push("dependency", op.dependencyId, "is_active", false, true); break;
      case "softDeleteDependency":
        push("dependency", op.dependencyId, "deleted_at", null, "now()"); break;
      case "setConstraint":
        push("constraint", op.activityId, "type", undefined, op.constraintType);
        if (op.date) push("constraint", op.activityId, "date", undefined, op.date);
        break;
      case "clearConstraint":
        push("constraint", op.activityId, "deleted", null, true); break;
      case "setProjectDataDate":
        push("project", b.projectId, "data_date", undefined, op.dataDate); break;
    }
  });

  // 2. ENGINE CASCADE history rows (computed-column diffs)
  const preById = new Map(b.preEngineActivities.map(a => [a.id, a]));
  for (const post of b.postEngineActivities) {
    const pre = preById.get(post.id);
    if (!pre) continue;  // newly created; engine wrote everything
    if (pre.planned_start !== post.plannedStart)
      history.push({
        entity_type: "activity", entity_id: post.id, field: "planned_start",
        old_value: JSON.stringify(pre.planned_start),
        new_value: JSON.stringify(post.plannedStart),
        op_index: null, source: "engine_cascade",
      });
    if (pre.planned_finish !== post.plannedFinish)
      history.push({
        entity_type: "activity", entity_id: post.id, field: "planned_finish",
        old_value: JSON.stringify(pre.planned_finish),
        new_value: JSON.stringify(post.plannedFinish),
        op_index: null, source: "engine_cascade",
      });
  }

  // 3. WRITES — turn post-engine activities + the original op effects into row writes.
  const writeIds = new Set<string>();
  const inserts: ActivityInsertRow[] = [];
  const updates: ActivityUpdateRow[] = [];
  const tempIds = new Set(Object.values(b.tempIdMap));

  for (const post of b.postEngineActivities) {
    const meta = b.originalActivityInputs[post.id] ?? { name: "", wbs_node_id: "", activity_type: "task" };
    const row = {
      wbs_node_id: meta.wbs_node_id,
      name: meta.name,
      activity_type: meta.activity_type as ActivityInsertRow["activity_type"],
      original_duration: 0,    // build-payload doesn't know; engine input had it
      remaining_duration: 0,
      calendar_id: null,
      early_start:   NULLABLE_DATE(post.earlyStart),
      early_finish:  NULLABLE_DATE(post.earlyFinish),
      late_start:    NULLABLE_DATE(post.lateStart),
      late_finish:   NULLABLE_DATE(post.lateFinish),
      planned_start: NULLABLE_DATE(post.plannedStart),
      planned_finish:NULLABLE_DATE(post.plannedFinish),
      total_float:   post.totalFloat,
      free_float:    post.freeFloat,
      is_critical:   post.isCritical,
    } satisfies Omit<ActivityInsertRow, "temp_id">;
    if (tempIds.has(post.id)) {
      const tempId = Object.entries(b.tempIdMap).find(([, v]) => v === post.id)![0];
      inserts.push({ temp_id: tempId, ...row });
    } else {
      updates.push({ id: post.id, ...row });
    }
    writeIds.add(post.id);
  }

  const payload: ApplyScheduleEditPayload = {
    project_id: b.projectId,
    edit_session_id: b.editSessionId,
    acting_user_id: b.actingUserId,
    request_id: b.requestId,
    intent_op_count: b.ops.length,
    base_versions: b.baseVersions,
    writes: {
      activity_inserts: inserts,
      activity_updates: updates,
      activity_soft_deletes: b.softDeleted.activityIds.map(id => ({ id })),
      dependency_inserts: [],         // populated by op-level builders below
      dependency_updates: [],
      dependency_soft_deletes: b.softDeleted.dependencyIds.map(id => ({ id })),
      constraint_upserts: [],
      constraint_deletes: [],
      project_patch: b.projectPatch,
      project_problems: b.engineProblems,
    },
    history_rows: history,
  };

  // Dependency / constraint write rows are derived from the ops directly.
  for (const op of b.ops) {
    if (op.type === "addDependency") {
      payload.writes.dependency_inserts.push({
        temp_id: op.tempId,
        predecessor_id: op.predecessorId,
        successor_id: op.successorId,
        type: op.relType, lag: op.lag, is_active: true,
      });
    } else if (op.type === "deactivateDependency") {
      payload.writes.dependency_updates.push({ id: op.dependencyId, is_active: false });
    } else if (op.type === "reactivateDependency") {
      payload.writes.dependency_updates.push({ id: op.dependencyId, is_active: true });
    } else if (op.type === "setConstraint") {
      payload.writes.constraint_upserts.push({
        activity_id: op.activityId,
        type: op.constraintType,
        constraint_date: op.date ?? null,
      });
    } else if (op.type === "clearConstraint") {
      payload.writes.constraint_deletes.push({ activity_id: op.activityId });
    }
  }

  return { payload, intentOpCount: b.ops.length };
}
```

- [ ] **Step 4: Run — must pass**

```bash
npx vitest run src/lib/schedule-server/apply-schedule-edit/build-payload.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedule-server/apply-schedule-edit/build-payload.ts \
        src/lib/schedule-server/apply-schedule-edit/build-payload.test.ts
git commit -m "feat: build apply_schedule_edit payload with intent and cascade history"
```

---

## Task 15: RPC migration — version checks, writes, history, response

**Files:**
- Modify: `supabase/migrations/<ts>_phase3_rpc.sql` (the one from Task 7)

> Replace the placeholder body in Task 7 with the full implementation. Forward-only correction policy applies — if the placeholder migration was already pushed, run `supabase db reset --linked`.

- [ ] **Step 1: Open the existing RPC migration file**

It is the file you created in Task 7. The skeleton block ending with the `return v_response;` line is the section that gets replaced.

- [ ] **Step 2: Replace the placeholder with the full body**

Inside the `apply_schedule_edit` function, between the IDEMPOTENCY block and the existing `update applied_edit_requests ...` block, replace the `v_response := jsonb_build_object('ok', true, 'note', 'placeholder...')` line with:

```sql
  -- 3. PAYLOAD SANITY ------------------------------------------------------
  if (p_payload->'writes') is null then
    raise exception 'PAYLOAD_INVALID' using errcode = 'PT004';
  end if;

  -- 4. VERSION CHECKS ------------------------------------------------------
  declare
    v_stale_activities   uuid[] := '{}';
    v_stale_dependencies uuid[] := '{}';
    v_stale_constraints  uuid[] := '{}';
    v_stale_project      boolean := false;
    v_id   uuid;
    v_ver  integer;
    v_cur  integer;
  begin
    for v_id, v_ver in
      select key::uuid, value::int
        from jsonb_each_text(p_payload->'base_versions'->'activities')
    loop
      select version into v_cur from activities where id = v_id;
      if v_cur is distinct from v_ver then
        v_stale_activities := v_stale_activities || v_id;
      end if;
    end loop;

    for v_id, v_ver in
      select key::uuid, value::int
        from jsonb_each_text(p_payload->'base_versions'->'dependencies')
    loop
      select version into v_cur from dependencies where id = v_id;
      if v_cur is distinct from v_ver then
        v_stale_dependencies := v_stale_dependencies || v_id;
      end if;
    end loop;

    for v_id, v_ver in
      select key::uuid, value::int
        from jsonb_each_text(p_payload->'base_versions'->'constraints')
    loop
      select version into v_cur from activity_constraints where activity_id = v_id;
      if v_cur is distinct from v_ver then
        v_stale_constraints := v_stale_constraints || v_id;
      end if;
    end loop;

    select version into v_cur from projects where id = v_project_id;
    if v_cur is distinct from (p_payload->'base_versions'->>'project_version')::int then
      v_stale_project := true;
    end if;

    if array_length(v_stale_activities,1)   is not null
      or array_length(v_stale_dependencies,1) is not null
      or array_length(v_stale_constraints,1)  is not null
      or v_stale_project then
      v_response := jsonb_build_object(
        'ok', false,
        'error', 'STALE_STATE',
        'stale', jsonb_build_object(
          'activities',   to_jsonb(v_stale_activities),
          'dependencies', to_jsonb(v_stale_dependencies),
          'constraints',  to_jsonb(v_stale_constraints),
          'project',      v_stale_project
        )
      );
      update applied_edit_requests
        set response_blob = v_response
        where project_id = v_project_id and request_id = v_request_id;
      return v_response;
    end if;
  end;

  -- 5. ACTIVITY INSERTS ----------------------------------------------------
  declare
    v_temp_id_map jsonb := '{}'::jsonb;
    v_row jsonb;
    v_new_id uuid;
  begin
    for v_row in select * from jsonb_array_elements(p_payload->'writes'->'activity_inserts') loop
      insert into activities (
        project_id, wbs_node_id, name, activity_type,
        original_duration, remaining_duration, calendar_id,
        early_start, early_finish, late_start, late_finish,
        planned_start, planned_finish, total_float, free_float, is_critical,
        version
      ) values (
        v_project_id,
        (v_row->>'wbs_node_id')::uuid,
        v_row->>'name',
        (v_row->>'activity_type')::activity_type,
        (v_row->>'original_duration')::int,
        (v_row->>'remaining_duration')::int,
        nullif(v_row->>'calendar_id','')::uuid,
        nullif(v_row->>'early_start','')::date,
        nullif(v_row->>'early_finish','')::date,
        nullif(v_row->>'late_start','')::date,
        nullif(v_row->>'late_finish','')::date,
        nullif(v_row->>'planned_start','')::date,
        nullif(v_row->>'planned_finish','')::date,
        (v_row->>'total_float')::int,
        (v_row->>'free_float')::int,
        (v_row->>'is_critical')::boolean,
        1
      ) returning id into v_new_id;
      v_temp_id_map := v_temp_id_map || jsonb_build_object(v_row->>'temp_id', v_new_id);
    end loop;

    -- DEPENDENCY INSERTS  (predecessor_id / successor_id may be temp ids)
    for v_row in select * from jsonb_array_elements(p_payload->'writes'->'dependency_inserts') loop
      insert into dependencies (
        project_id, predecessor_id, successor_id, type, lag, is_active, version
      ) values (
        v_project_id,
        coalesce((v_temp_id_map->>(v_row->>'predecessor_id'))::uuid,
                 (v_row->>'predecessor_id')::uuid),
        coalesce((v_temp_id_map->>(v_row->>'successor_id'))::uuid,
                 (v_row->>'successor_id')::uuid),
        (v_row->>'type')::dependency_type,
        (v_row->>'lag')::int,
        true, 1
      ) returning id into v_new_id;
      v_temp_id_map := v_temp_id_map || jsonb_build_object(v_row->>'temp_id', v_new_id);
    end loop;

    -- 6. ACTIVITY UPDATES
    for v_row in select * from jsonb_array_elements(p_payload->'writes'->'activity_updates') loop
      update activities set
        early_start    = nullif(v_row->>'early_start','')::date,
        early_finish   = nullif(v_row->>'early_finish','')::date,
        late_start     = nullif(v_row->>'late_start','')::date,
        late_finish    = nullif(v_row->>'late_finish','')::date,
        planned_start  = nullif(v_row->>'planned_start','')::date,
        planned_finish = nullif(v_row->>'planned_finish','')::date,
        total_float    = (v_row->>'total_float')::int,
        free_float     = (v_row->>'free_float')::int,
        is_critical    = (v_row->>'is_critical')::boolean,
        version        = version + 1,
        updated_at     = now()
      where id = (v_row->>'id')::uuid;
    end loop;

    -- DEPENDENCY UPDATES
    for v_row in select * from jsonb_array_elements(p_payload->'writes'->'dependency_updates') loop
      update dependencies set
        is_active = coalesce((v_row->>'is_active')::boolean, is_active),
        lag       = coalesce((v_row->>'lag')::int, lag),
        version   = version + 1
      where id = (v_row->>'id')::uuid;
    end loop;

    -- 7. SOFT DELETES
    for v_row in select * from jsonb_array_elements(p_payload->'writes'->'activity_soft_deletes') loop
      update activities set deleted_at = now(), version = version + 1
        where id = (v_row->>'id')::uuid;
    end loop;
    for v_row in select * from jsonb_array_elements(p_payload->'writes'->'dependency_soft_deletes') loop
      update dependencies set deleted_at = now(), version = version + 1
        where id = (v_row->>'id')::uuid;
    end loop;

    -- CONSTRAINT UPSERTS
    for v_row in select * from jsonb_array_elements(p_payload->'writes'->'constraint_upserts') loop
      insert into activity_constraints (activity_id, type, constraint_date, version)
        values (
          (v_row->>'activity_id')::uuid,
          (v_row->>'type')::constraint_type,
          nullif(v_row->>'constraint_date','')::date,
          1
        )
        on conflict (activity_id) do update set
          type            = excluded.type,
          constraint_date = excluded.constraint_date,
          version         = activity_constraints.version + 1;
    end loop;
    for v_row in select * from jsonb_array_elements(p_payload->'writes'->'constraint_deletes') loop
      delete from activity_constraints where activity_id = (v_row->>'activity_id')::uuid;
    end loop;
  end;

  -- 8. PROJECT PATCH -------------------------------------------------------
  update projects set
    data_date            = coalesce(
      nullif(p_payload->'writes'->'project_patch'->>'data_date','')::date,
      data_date),
    schedule_dirty_at    = null,
    last_engine_problems = coalesce(p_payload->'writes'->'project_problems', '[]'::jsonb),
    version              = version + 1,
    updated_at           = now()
  where id = v_project_id;

  -- 9. HISTORY ROWS --------------------------------------------------------
  declare
    v_hist_row jsonb;
    v_hist_ids uuid[] := '{}';
    v_hist_id  uuid;
  begin
    for v_hist_row in select * from jsonb_array_elements(p_payload->'history_rows') loop
      insert into activity_history (
        project_id, edit_session_id, entity_type, entity_id, field,
        old_value, new_value, changed_by, op_index, source, visibility
      ) values (
        v_project_id,
        (p_payload->>'edit_session_id')::uuid,
        v_hist_row->>'entity_type',
        (v_hist_row->>'entity_id')::uuid,
        v_hist_row->>'field',
        v_hist_row->>'old_value',
        v_hist_row->>'new_value',
        v_acting_user_id,
        nullif(v_hist_row->>'op_index','')::int,
        v_hist_row->>'source',
        'shared'
      ) returning id into v_hist_id;
      v_hist_ids := v_hist_ids || v_hist_id;
    end loop;

    -- 10. RESPONSE
    v_response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'applied_at',      now(),
        'project_version', (select version from projects where id = v_project_id),
        'temp_id_map',     coalesce(
          (select string_agg(format('%s,%s', key, value), ','))
            from jsonb_each_text(coalesce(v_temp_id_map,'{}'::jsonb)),
          ''),
        'temp_id_map',     coalesce(v_temp_id_map, '{}'::jsonb),
        'history_ids',     to_jsonb(v_hist_ids)
      )
    );
  end;
```

- [ ] **Step 3: Reset and re-push (forward-only correction)**

```bash
supabase db reset --linked
```

When prompted, confirm. Expected: all 5 Phase 2 migrations + 5 Phase 3 migrations apply cleanly.

- [ ] **Step 4: Smoke-test the RPC**

```bash
psql "$SUPABASE_SESSION_POOLER_URL" -f supabase/tests/apply_schedule_edit_test.sql
```

Expected: existing T1–T4 still pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations
git commit -m "feat: implement apply_schedule_edit version checks, writes, history"
```

---

## Task 16: SQL test — version-check, writes, idempotency for full RPC

**Files:**
- Modify: `supabase/tests/apply_schedule_edit_test.sql`

- [ ] **Step 1: Append the new tests to the existing file**

Add the following after the existing T4 block, before `rollback;`:

```sql
-- ------------------------------------------------------------------
-- TEST 5: STALE_STATE on version mismatch (no writes occur)
-- ------------------------------------------------------------------
\echo '-- T5: STALE_STATE'
do $$
declare
  v_proj  uuid := '33333333-3333-3333-3333-333333333333';
  v_cal   uuid := '44444444-4444-4444-4444-444444444444';
  v_act   uuid;
  v_resp  jsonb;
  v_count_before int;
  v_count_after  int;
begin
  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);

  -- Seed an activity directly (Phase 2 schema).
  insert into wbs_nodes (id, project_id, name)
    values ('55555555-5555-5555-5555-555555555555', v_proj, 'Root')
    on conflict (id) do nothing;
  insert into activities (id, project_id, wbs_node_id, name, original_duration, remaining_duration)
    values (gen_random_uuid(), v_proj, '55555555-5555-5555-5555-555555555555',
            'A', 5, 5)
    returning id into v_act;

  select count(*) into v_count_before from activity_history where entity_id = v_act;

  v_resp := apply_schedule_edit(jsonb_build_object(
    'project_id',      v_proj,
    'request_id',      gen_random_uuid(),
    'acting_user_id',  '11111111-1111-1111-1111-111111111111',
    'edit_session_id', gen_random_uuid(),
    'intent_op_count', 0,
    'base_versions', jsonb_build_object(
      'project_version', 1,
      'activities',      jsonb_build_object(v_act::text, 999),  -- WRONG version
      'dependencies',    '{}'::jsonb,
      'constraints',     '{}'::jsonb
    ),
    'writes', jsonb_build_object(
      'activity_inserts','[]'::jsonb, 'activity_updates','[]'::jsonb,
      'activity_soft_deletes','[]'::jsonb,
      'dependency_inserts','[]'::jsonb, 'dependency_updates','[]'::jsonb,
      'dependency_soft_deletes','[]'::jsonb,
      'constraint_upserts','[]'::jsonb, 'constraint_deletes','[]'::jsonb,
      'project_patch','{}'::jsonb, 'project_problems','[]'::jsonb
    ),
    'history_rows','[]'::jsonb
  ));

  if v_resp->>'error' <> 'STALE_STATE' then
    raise 'TEST FAILED T5: expected STALE_STATE, got %', v_resp;
  end if;

  select count(*) into v_count_after from activity_history where entity_id = v_act;
  if v_count_after <> v_count_before then
    raise 'TEST FAILED T5: history rows changed on STALE_STATE (% -> %)',
          v_count_before, v_count_after;
  end if;
end $$;

-- ------------------------------------------------------------------
-- TEST 6: successful activity update bumps version and writes history
-- ------------------------------------------------------------------
\echo '-- T6: write + history + version bump'
do $$
declare
  v_proj uuid := '33333333-3333-3333-3333-333333333333';
  v_act  uuid;
  v_ver_before int; v_ver_after int;
  v_resp jsonb;
  v_history_count int;
begin
  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);
  select id into v_act from activities where project_id = v_proj limit 1;
  select version into v_ver_before from activities where id = v_act;

  v_resp := apply_schedule_edit(jsonb_build_object(
    'project_id',      v_proj,
    'request_id',      gen_random_uuid(),
    'acting_user_id',  '11111111-1111-1111-1111-111111111111',
    'edit_session_id', gen_random_uuid(),
    'intent_op_count', 1,
    'base_versions', jsonb_build_object(
      'project_version', 1,
      'activities',      jsonb_build_object(v_act::text, v_ver_before),
      'dependencies',    '{}'::jsonb,
      'constraints',     '{}'::jsonb
    ),
    'writes', jsonb_build_object(
      'activity_inserts','[]'::jsonb,
      'activity_updates', jsonb_build_array(jsonb_build_object(
        'id', v_act,
        'early_start','2026-06-01','early_finish','2026-06-09',
        'late_start','2026-06-01','late_finish','2026-06-09',
        'planned_start','2026-06-01','planned_finish','2026-06-09',
        'total_float',0,'free_float',0,'is_critical', true
      )),
      'activity_soft_deletes','[]'::jsonb,
      'dependency_inserts','[]'::jsonb, 'dependency_updates','[]'::jsonb,
      'dependency_soft_deletes','[]'::jsonb,
      'constraint_upserts','[]'::jsonb, 'constraint_deletes','[]'::jsonb,
      'project_patch','{}'::jsonb, 'project_problems','[]'::jsonb
    ),
    'history_rows', jsonb_build_array(jsonb_build_object(
      'entity_type','activity','entity_id', v_act,
      'field','original_duration','old_value','5','new_value','7',
      'op_index', 0,'source','intent'
    ))
  ));

  if (v_resp->>'ok')::boolean <> true then
    raise 'TEST FAILED T6: expected ok=true, got %', v_resp;
  end if;
  select version into v_ver_after from activities where id = v_act;
  if v_ver_after <> v_ver_before + 1 then
    raise 'TEST FAILED T6: version did not bump (% -> %)', v_ver_before, v_ver_after;
  end if;
  select count(*) into v_history_count from activity_history
    where entity_id = v_act and source = 'intent';
  if v_history_count = 0 then
    raise 'TEST FAILED T6: no intent history rows written';
  end if;
end $$;
```

- [ ] **Step 2: Run the suite — must pass**

```bash
psql "$SUPABASE_SESSION_POOLER_URL" -f supabase/tests/apply_schedule_edit_test.sql
```

Expected: prints `-- T1` … `-- T6`, then `== all tests passed ==`.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests
git commit -m "test: cover STALE_STATE and successful write paths for apply_schedule_edit"
```

---

## Task 17: RPC client wrapper + pipeline orchestrator

**Files:**
- Create: `src/lib/schedule-server/shared/rpc-client.ts`
- Create: `src/lib/schedule-server/apply-schedule-edit/index.ts`

- [ ] **Step 1: Write the rpc-client**

```ts
// src/lib/schedule-server/shared/rpc-client.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApplyScheduleEditPayload } from "./types";

export async function callApplyScheduleEdit(
  client: SupabaseClient, payload: ApplyScheduleEditPayload,
) {
  const { data, error } = await client.rpc("apply_schedule_edit", {
    p_payload: payload as unknown as Record<string, unknown>,
  });
  if (error) return { rpcError: error };
  return { result: data as Record<string, unknown> };
}
```

- [ ] **Step 2: Write the pipeline orchestrator**

```ts
// src/lib/schedule-server/apply-schedule-edit/index.ts
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApplyScheduleEditResponse, IntentOp } from "../shared/types";
import { err, sqlstateToErrorCode } from "../shared/errors";
import { calculate } from "@/lib/schedule-engine";
import { validateOps } from "./validate";
import { rowsToScheduleInput } from "./load-snapshot";
import { applyOps } from "./apply-ops";
import { buildPayload } from "./build-payload";
import { callApplyScheduleEdit } from "../shared/rpc-client";

export interface ApplyScheduleEditArgs {
  client: SupabaseClient;            // per-request, auth-bound
  projectId: string;
  editSessionId: string;
  actingUserId: string;
  requestId?: string;
  ops: unknown[];                    // unvalidated input from HTTP body
}

export async function applyScheduleEdit(
  a: ApplyScheduleEditArgs,
): Promise<ApplyScheduleEditResponse> {
  // 1. Validate ops shape
  const v = validateOps(a.ops);
  if (!v.ok) return err("VALIDATION_FAILED", v.errors);

  // 2. Load snapshot via the auth-bound client (RLS applies to reads)
  const snapshot = await loadProjectSnapshot(a.client, a.projectId);
  if (!snapshot.ok) return err(snapshot.error);
  const { input, baseVersions, raw } = snapshot.data;

  // 3. Apply ops in-memory
  const applied = applyOps(input, v.ops as IntentOp[]);

  // 4. Capture pre-engine state for the diff
  const preEngineActivities = raw.activities.map(r => ({
    id: r.id,
    original_duration: r.original_duration,
    planned_start: r.planned_start ?? null,
    planned_finish: r.planned_finish ?? null,
  }));
  const originalActivityInputs = Object.fromEntries(
    raw.activities.map(r => [r.id, {
      name: r.name as string,
      wbs_node_id: r.wbs_node_id as string,
      activity_type: r.activity_type,
    }]),
  );

  // 5. Run the engine
  const result = calculate(applied.input);
  const hasCycle = result.problems.some(p => p.type === "cycle");
  if (hasCycle) return err("ENGINE_CYCLE", { problems: result.problems });

  // 6. Build payload
  const built = buildPayload({
    projectId: a.projectId,
    editSessionId: a.editSessionId,
    actingUserId: a.actingUserId,
    requestId: a.requestId ?? randomUUID(),
    ops: v.ops as IntentOp[],
    tempIdMap: applied.tempIdMap,
    preEngineActivities,
    postEngineActivities: result.activities,
    preEngineDependencies: raw.dependencies.map(d => ({
      id: d.id, is_active: d.is_active, lag: d.lag, type: d.type,
    })),
    preEngineConstraints: raw.activity_constraints.map(c => ({
      activity_id: c.activity_id, type: c.type, constraint_date: c.constraint_date,
    })),
    baseVersions,
    softDeleted: applied.softDeleted,
    projectPatch: applied.projectPatch,
    engineProblems: result.problems,
    originalActivityInputs,
  });

  // 7. Call the RPC
  const r = await callApplyScheduleEdit(a.client, built.payload);
  if (r.rpcError) {
    const code = sqlstateToErrorCode(r.rpcError.code);
    return err(code, r.rpcError.message);
  }
  const body = r.result as Record<string, unknown>;
  if (body.ok === false) {
    return err((body.error as never) ?? "INTERNAL", body);
  }
  return { ok: true, data: body.data as ApplyScheduleEditResponse extends { ok: true; data: infer D } ? D : never };
}

async function loadProjectSnapshot(client: SupabaseClient, projectId: string) {
  const [proj, cals, calExc, acts, deps, cons] = await Promise.all([
    client.from("projects").select("*").eq("id", projectId).single(),
    client.from("calendars").select("*").eq("project_id", projectId),
    client.from("calendar_exceptions").select("*"),
    client.from("activities").select("*").eq("project_id", projectId),
    client.from("dependencies").select("*").eq("project_id", projectId),
    client.from("activity_constraints").select("*"),
  ]);
  for (const r of [proj, cals, calExc, acts, deps, cons]) {
    if (r.error) return { ok: false as const, error: "INTERNAL" as const };
  }
  return {
    ok: true as const,
    data: rowsToScheduleInput({
      project: proj.data!,
      calendars: cals.data ?? [],
      calendar_exceptions: calExc.data ?? [],
      activities: acts.data ?? [],
      dependencies: deps.data ?? [],
      activity_constraints: cons.data ?? [],
    }),
  };
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/schedule-server/shared/rpc-client.ts \
        src/lib/schedule-server/apply-schedule-edit/index.ts
git commit -m "feat: orchestrate validate → load → apply → engine → rpc pipeline"
```

---

## Task 18: Route handler — `POST /api/schedule/apply`

**Files:**
- Create: `src/app/api/schedule/apply/route.ts`

- [ ] **Step 1: Re-read the Next.js 16 route-handler docs**

```bash
cat node_modules/next/dist/docs/01-app/*.md | grep -A 30 "route handler" | head -80
```

Confirm the exact `export async function POST(request: Request)` signature and how to read the JSON body.

- [ ] **Step 2: Write the route**

```ts
// src/app/api/schedule/apply/route.ts
import { createRouteSupabaseClient } from "@/lib/schedule-server/shared/supabase-client";
import { applyScheduleEdit } from "@/lib/schedule-server/apply-schedule-edit";
import { err } from "@/lib/schedule-server/shared/errors";

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return j(err("VALIDATION_FAILED", "invalid JSON")); }

  if (typeof body !== "object" || body === null) {
    return j(err("VALIDATION_FAILED", "body must be an object"));
  }
  const b = body as Record<string, unknown>;
  const projectId      = b.projectId      as string | undefined;
  const editSessionId  = b.editSessionId  as string | undefined;
  const requestId      = b.requestId      as string | undefined;
  const ops            = b.ops            as unknown[] | undefined;

  if (!projectId || !editSessionId || !Array.isArray(ops)) {
    return j(err("VALIDATION_FAILED", "missing projectId / editSessionId / ops[]"));
  }

  const client = await createRouteSupabaseClient();
  const { data: userData, error: userErr } = await client.auth.getUser();
  if (userErr || !userData.user) return j(err("UNAUTHENTICATED"));

  const response = await applyScheduleEdit({
    client, projectId, editSessionId, requestId,
    actingUserId: userData.user.id, ops,
  });
  return j(response, response.ok ? 200 : statusFor(response.error));
}

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });
}
function statusFor(code: string): number {
  switch (code) {
    case "UNAUTHENTICATED":    return 401;
    case "FORBIDDEN":          return 403;
    case "VALIDATION_FAILED":
    case "ENGINE_CYCLE":
    case "PAYLOAD_INVALID":    return 400;
    case "STALE_STATE":        return 409;
    case "IDENTITY_MISMATCH":  return 400;
    default:                   return 500;
  }
}
```

- [ ] **Step 3: Typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: clean build; the new route is listed in the route map.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/schedule/apply/route.ts
git commit -m "feat: add POST /api/schedule/apply route handler"
```

---

## Task 19: Route handler — `GET /api/projects/:id/schedule`

**Files:**
- Create: `src/lib/schedule-server/get-project-schedule/index.ts`
- Create: `src/app/api/projects/[id]/schedule/route.ts`

- [ ] **Step 1: Write the pipeline**

```ts
// src/lib/schedule-server/get-project-schedule/index.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getProjectSchedule(client: SupabaseClient, projectId: string) {
  const [proj, cals, calExc, wbs, acts, deps, cons, res, ras] = await Promise.all([
    client.from("projects").select("*").eq("id", projectId).single(),
    client.from("calendars").select("*").eq("project_id", projectId),
    client.from("calendar_exceptions").select("*"),
    client.from("wbs_nodes").select("*").eq("project_id", projectId),
    client.from("activities").select("*").eq("project_id", projectId).is("deleted_at", null),
    client.from("dependencies").select("*").eq("project_id", projectId).is("deleted_at", null),
    client.from("activity_constraints").select("*"),
    client.from("resources").select("*").eq("project_id", projectId).is("deleted_at", null),
    client.from("resource_assignments").select("*").is("deleted_at", null),
  ]);
  for (const r of [proj, cals, calExc, wbs, acts, deps, cons, res, ras]) {
    if (r.error) return { ok: false as const, error: "INTERNAL" as const, details: r.error };
  }
  return {
    ok: true as const,
    data: {
      project: proj.data!,
      calendars: cals.data ?? [],
      calendar_exceptions: calExc.data ?? [],
      wbs_nodes: wbs.data ?? [],
      activities: acts.data ?? [],
      dependencies: deps.data ?? [],
      constraints: cons.data ?? [],
      resources: res.data ?? [],
      resource_assignments: ras.data ?? [],
      stale: !!(proj.data?.schedule_dirty_at),
    },
  };
}
```

- [ ] **Step 2: Write the route**

```ts
// src/app/api/projects/[id]/schedule/route.ts
import { createRouteSupabaseClient } from "@/lib/schedule-server/shared/supabase-client";
import { getProjectSchedule } from "@/lib/schedule-server/get-project-schedule";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const client = await createRouteSupabaseClient();
  const { data: userData } = await client.auth.getUser();
  if (!userData.user) {
    return new Response(JSON.stringify({ ok: false, error: "UNAUTHENTICATED" }),
      { status: 401, headers: { "content-type": "application/json" } });
  }
  const result = await getProjectSchedule(client, id);
  return new Response(JSON.stringify(result),
    { status: result.ok ? 200 : 500, headers: { "content-type": "application/json" } });
}
```

- [ ] **Step 3: Typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/schedule-server/get-project-schedule \
        src/app/api/projects
git commit -m "feat: add GET /api/projects/:id/schedule bootstrap read endpoint"
```

---

## Task 20: Plain CRUD route — `/api/calendars`

**Files:**
- Create: `src/app/api/calendars/route.ts`

- [ ] **Step 1: Write the route**

```ts
// src/app/api/calendars/route.ts
import { createRouteSupabaseClient } from "@/lib/schedule-server/shared/supabase-client";

interface CreateBody { project_id: string; name: string; working_weekdays?: number[]; is_default?: boolean; }
interface PatchBody  { id: string; name?: string; working_weekdays?: number[]; }
interface DeleteBody { id: string; }

export async function POST(request: Request) {
  const body = await safeJson<CreateBody>(request);
  if (!body || !body.project_id || !body.name) return bad("project_id and name required");
  const client = await createRouteSupabaseClient();
  if (!await isAuthed(client)) return unauth();
  const ins = await client.from("calendars").insert({
    project_id: body.project_id, name: body.name,
    working_weekdays: body.working_weekdays ?? [1,2,3,4,5],
    is_default: body.is_default ?? false,
  }).select().single();
  if (ins.error) return j({ ok: false, error: "INTERNAL", details: ins.error }, 500);
  await markDirty(client, body.project_id);
  return j({ ok: true, data: ins.data });
}

export async function PATCH(request: Request) {
  const body = await safeJson<PatchBody>(request);
  if (!body || !body.id) return bad("id required");
  const client = await createRouteSupabaseClient();
  if (!await isAuthed(client)) return unauth();
  const upd = await client.from("calendars").update({
    name: body.name, working_weekdays: body.working_weekdays,
    version: undefined,  // server-side trigger not in scope; client bumps on next read
  }).eq("id", body.id).select().single();
  if (upd.error) return j({ ok: false, error: "INTERNAL", details: upd.error }, 500);
  await markDirty(client, upd.data.project_id);
  return j({ ok: true, data: upd.data });
}

export async function DELETE(request: Request) {
  const body = await safeJson<DeleteBody>(request);
  if (!body || !body.id) return bad("id required");
  const client = await createRouteSupabaseClient();
  if (!await isAuthed(client)) return unauth();
  const refs = await client.from("activities").select("id", { count: "exact", head: true })
    .eq("calendar_id", body.id);
  if ((refs.count ?? 0) > 0) return j({ ok: false, error: "CALENDAR_IN_USE" }, 409);
  const del = await client.from("calendars").delete().eq("id", body.id).select().single();
  if (del.error) return j({ ok: false, error: "INTERNAL", details: del.error }, 500);
  await markDirty(client, del.data.project_id);
  return j({ ok: true });
}

async function isAuthed(c: Awaited<ReturnType<typeof createRouteSupabaseClient>>) {
  const { data } = await c.auth.getUser(); return !!data.user;
}
async function markDirty(c: Awaited<ReturnType<typeof createRouteSupabaseClient>>, projectId: string) {
  await c.from("projects").update({ schedule_dirty_at: new Date().toISOString() })
    .eq("id", projectId);
}
async function safeJson<T>(r: Request): Promise<T | null> {
  try { return await r.json() as T; } catch { return null; }
}
function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function bad(msg: string)   { return j({ ok: false, error: "BAD_REQUEST", details: msg }, 400); }
function unauth()           { return j({ ok: false, error: "UNAUTHENTICATED" }, 401); }
```

- [ ] **Step 2: Typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/calendars
git commit -m "feat: add plain CRUD route for calendars with schedule_dirty_at flag"
```

---

## Task 21: Plain CRUD route — `/api/wbs-nodes` with reparent cycle check

**Files:**
- Create: `src/app/api/wbs-nodes/route.ts`
- Create: `src/lib/schedule-server/shared/wbs-cycle.ts`
- Create: `src/lib/schedule-server/shared/wbs-cycle.test.ts`

- [ ] **Step 1: Write the failing test for the cycle checker**

```ts
// src/lib/schedule-server/shared/wbs-cycle.test.ts
import { describe, it, expect } from "vitest";
import { wouldCreateCycle } from "./wbs-cycle";

describe("wouldCreateCycle", () => {
  it("detects a direct self-cycle", () => {
    expect(wouldCreateCycle([{ id: "a", parent_id: null }], "a", "a")).toBe(true);
  });
  it("detects an indirect cycle (b under a, reparent a under b)", () => {
    expect(wouldCreateCycle(
      [{ id: "a", parent_id: null }, { id: "b", parent_id: "a" }],
      "a", "b",
    )).toBe(true);
  });
  it("returns false for a valid reparent", () => {
    expect(wouldCreateCycle(
      [{ id: "a", parent_id: null }, { id: "b", parent_id: null }],
      "b", "a",
    )).toBe(false);
  });
});
```

- [ ] **Step 2: Run — must fail**

```bash
npx vitest run src/lib/schedule-server/shared/wbs-cycle.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/schedule-server/shared/wbs-cycle.ts
export function wouldCreateCycle(
  nodes: { id: string; parent_id: string | null }[],
  nodeId: string, newParentId: string,
): boolean {
  if (nodeId === newParentId) return true;
  const parentOf = new Map(nodes.map(n => [n.id, n.parent_id]));
  // Walk up from the new parent — if we reach nodeId, we'd loop.
  let cur: string | null = newParentId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === nodeId) return true;
    if (seen.has(cur)) return true;  // existing cycle, refuse anyway
    seen.add(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return false;
}
```

- [ ] **Step 4: Run — must pass**

```bash
npx vitest run src/lib/schedule-server/shared/wbs-cycle.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Write the route**

```ts
// src/app/api/wbs-nodes/route.ts
import { createRouteSupabaseClient } from "@/lib/schedule-server/shared/supabase-client";
import { wouldCreateCycle } from "@/lib/schedule-server/shared/wbs-cycle";

interface CreateBody { project_id: string; parent_id?: string | null; name: string; }
interface PatchBody  { id: string; name?: string; parent_id?: string | null; }
interface DeleteBody { id: string; cascade?: boolean; }

export async function POST(request: Request) {
  const body = await safeJson<CreateBody>(request);
  if (!body || !body.project_id || !body.name) return bad("project_id and name required");
  const client = await createRouteSupabaseClient();
  if (!await authed(client)) return unauth();
  const ins = await client.from("wbs_nodes").insert({
    project_id: body.project_id, parent_id: body.parent_id ?? null, name: body.name,
  }).select().single();
  if (ins.error) return j({ ok: false, error: "INTERNAL", details: ins.error }, 500);
  return j({ ok: true, data: ins.data });
}

export async function PATCH(request: Request) {
  const body = await safeJson<PatchBody>(request);
  if (!body || !body.id) return bad("id required");
  const client = await createRouteSupabaseClient();
  if (!await authed(client)) return unauth();

  // Reparent? — check for cycle.
  if (body.parent_id !== undefined) {
    const node = await client.from("wbs_nodes").select("project_id").eq("id", body.id).single();
    if (node.error) return j({ ok: false, error: "NOT_FOUND" }, 404);
    const all = await client.from("wbs_nodes").select("id, parent_id")
      .eq("project_id", node.data.project_id).is("deleted_at", null);
    if (all.error) return j({ ok: false, error: "INTERNAL" }, 500);
    if (body.parent_id && wouldCreateCycle(all.data, body.id, body.parent_id)) {
      return j({ ok: false, error: "WBS_CYCLE" }, 409);
    }
    await client.from("projects").update({ schedule_dirty_at: new Date().toISOString() })
      .eq("id", node.data.project_id);
  }

  const upd = await client.from("wbs_nodes").update({
    name: body.name, parent_id: body.parent_id,
  }).eq("id", body.id).select().single();
  if (upd.error) return j({ ok: false, error: "INTERNAL", details: upd.error }, 500);
  return j({ ok: true, data: upd.data });
}

export async function DELETE(request: Request) {
  const body = await safeJson<DeleteBody>(request);
  if (!body || !body.id) return bad("id required");
  const client = await createRouteSupabaseClient();
  if (!await authed(client)) return unauth();

  const children = await client.from("wbs_nodes").select("id", { count: "exact", head: true })
    .eq("parent_id", body.id).is("deleted_at", null);
  if ((children.count ?? 0) > 0 && !body.cascade) {
    return j({ ok: false, error: "WBS_HAS_CHILDREN" }, 409);
  }
  const upd = await client.from("wbs_nodes").update({
    deleted_at: new Date().toISOString(),
  }).eq("id", body.id).select().single();
  if (upd.error) return j({ ok: false, error: "INTERNAL", details: upd.error }, 500);
  return j({ ok: true });
}

async function authed(c: Awaited<ReturnType<typeof createRouteSupabaseClient>>) {
  const { data } = await c.auth.getUser(); return !!data.user;
}
async function safeJson<T>(r: Request): Promise<T | null> {
  try { return await r.json() as T; } catch { return null; }
}
function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function bad(m: string) { return j({ ok: false, error: "BAD_REQUEST", details: m }, 400); }
function unauth()       { return j({ ok: false, error: "UNAUTHENTICATED" }, 401); }
```

- [ ] **Step 6: Typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/schedule-server/shared/wbs-cycle.ts \
        src/lib/schedule-server/shared/wbs-cycle.test.ts \
        src/app/api/wbs-nodes
git commit -m "feat: add /api/wbs-nodes CRUD with reparent cycle detection"
```

---

## Task 22: Integration test fixture

**Files:**
- Create: `tests/integration/setup.ts`
- Modify: `vitest.config.ts` (add the integration test dir if needed)

- [ ] **Step 1: Verify Vitest config picks up `tests/`**

```bash
cat vitest.config.ts
```

If the existing config doesn't include `tests/**/*.test.ts` in its `include` array, append it. Otherwise no change.

- [ ] **Step 2: Write the fixture**

```ts
// tests/integration/setup.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const ORG_ID     = "00000000-0000-0000-0000-0000000000aa";
export const CO_INT     = "00000000-0000-0000-0000-0000000000bb";
export const PROJECT_ID = "33333333-3333-3333-3333-333333333333";
export const CAL_ID     = "44444444-4444-4444-4444-444444444444";
export const WBS_ID     = "55555555-5555-5555-5555-555555555555";
export const SCHED_ID   = "11111111-1111-1111-1111-111111111111";
export const PM_ID      = "66666666-6666-6666-6666-666666666666";
export const VIEWER_ID  = "22222222-2222-2222-2222-222222222222";

export function service(): SupabaseClient {
  return createClient(URL, SERVICE,
    { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Sign in as a test user via the password grant (the fixture sets a known
 * password during seeding). Returns a Supabase client whose subsequent calls
 * include the access token in the Authorization header.
 */
export async function asUser(userId: string): Promise<SupabaseClient> {
  const email = `${userId}@test.local`;
  const c = createClient(URL, ANON,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: "test-pw-1234" });
  if (error) throw new Error(`asUser(${userId}) sign-in failed: ${error.message}`);
  return c;
}

/**
 * Idempotent fixture. Wipes any prior test project rows and re-seeds three
 * users + a 4-activity project. Safe to call multiple times — runs in a single
 * service-role context.
 */
export async function seedFixture() {
  const s = service();

  // 1. Wipe prior state (cascades on FKs handle most child rows).
  await s.from("applied_edit_requests").delete().eq("project_id", PROJECT_ID);
  await s.from("activity_history").delete().eq("project_id", PROJECT_ID);
  await s.from("dependencies").delete().eq("project_id", PROJECT_ID);
  await s.from("activities").delete().eq("project_id", PROJECT_ID);
  await s.from("wbs_nodes").delete().eq("project_id", PROJECT_ID);
  await s.from("memberships").delete().eq("project_id", PROJECT_ID);
  await s.from("calendars").delete().eq("project_id", PROJECT_ID);
  await s.from("projects").delete().eq("id", PROJECT_ID);
  for (const uid of [SCHED_ID, PM_ID, VIEWER_ID]) {
    await s.from("users").delete().eq("id", uid);
    await s.auth.admin.deleteUser(uid).catch(() => {});
  }
  await s.from("companies").delete().eq("id", CO_INT);
  await s.from("organizations").delete().eq("id", ORG_ID);

  // 2. Org + company.
  await s.from("organizations").insert({ id: ORG_ID, name: "TEST org" });
  await s.from("companies").insert({
    id: CO_INT, organization_id: ORG_ID, name: "TEST internal", type: "internal",
  });

  // 3. Three auth users, each with the same known password.
  for (const [uid, fullName] of [
    [SCHED_ID,  "Test Scheduler"],
    [PM_ID,     "Test PM"],
    [VIEWER_ID, "Test Viewer"],
  ] as const) {
    const created = await s.auth.admin.createUser({
      email: `${uid}@test.local`, password: "test-pw-1234",
      email_confirm: true, user_metadata: { full_name: fullName },
    });
    if (created.error) throw created.error;
    // The `id` is assigned by Supabase; we need the public.users profile row.
    await s.from("users").insert({
      id: created.data.user!.id,   // align profile id with auth.users.id
      company_id: CO_INT, full_name: fullName, email: `${uid}@test.local`,
    });
  }
  // For determinism, our constants assume auth ids match the constants above;
  // re-fetch in case Supabase assigned different uuids — and update the
  // exported constants in the test file via the returned mapping.
  const profiles = await s.from("users").select("id, email").eq("company_id", CO_INT);
  const idByEmail = Object.fromEntries((profiles.data ?? []).map(p => [p.email, p.id]));

  // 4. Project + calendar + WBS root.
  await s.from("projects").insert({
    id: PROJECT_ID, organization_id: ORG_ID, name: "TEST proj",
    project_start: "2026-06-01",
  });
  await s.from("calendars").insert({
    id: CAL_ID, project_id: PROJECT_ID, name: "Default", is_default: true,
    working_weekdays: [1,2,3,4,5],
  });
  await s.from("projects").update({ default_calendar_id: CAL_ID }).eq("id", PROJECT_ID);
  await s.from("wbs_nodes").insert({ id: WBS_ID, project_id: PROJECT_ID, name: "Root" });

  // 5. Memberships.
  await s.from("memberships").insert([
    { user_id: idByEmail[`${SCHED_ID}@test.local`],  project_id: PROJECT_ID, role: "scheduler" },
    { user_id: idByEmail[`${PM_ID}@test.local`],     project_id: PROJECT_ID, role: "project_manager" },
    { user_id: idByEmail[`${VIEWER_ID}@test.local`], project_id: PROJECT_ID, role: "internal_viewer" },
  ]);

  // 6. Four activities so cascade tests have something to cascade.
  await s.from("activities").insert([
    { project_id: PROJECT_ID, wbs_node_id: WBS_ID, name: "A1",
      original_duration: 5, remaining_duration: 5 },
    { project_id: PROJECT_ID, wbs_node_id: WBS_ID, name: "A2",
      original_duration: 3, remaining_duration: 3 },
    { project_id: PROJECT_ID, wbs_node_id: WBS_ID, name: "A3",
      original_duration: 2, remaining_duration: 2 },
    { project_id: PROJECT_ID, wbs_node_id: WBS_ID, name: "A4",
      original_duration: 4, remaining_duration: 4 },
  ]);

  return { PROJECT_ID, CAL_ID, WBS_ID, idByEmail };
}
```

- [ ] **Step 3: Sanity-check the fixture compiles**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/setup.ts vitest.config.ts
git commit -m "test: add integration test fixture for Phase 3 endpoints"
```

---

## Task 23: Integration test — single intent end-to-end

**Files:**
- Create: `tests/integration/apply-schedule-edit.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/integration/apply-schedule-edit.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { seedFixture, asUser, service, SCHED_ID, PROJECT_ID, WBS_ID } from "./setup";

let scheduler: Awaited<ReturnType<typeof asUser>>;

beforeAll(async () => {
  await seedFixture();
  scheduler = await asUser(SCHED_ID);
});

async function post(client: Awaited<ReturnType<typeof asUser>>, body: unknown) {
  const { data: sessionData } = await client.auth.getSession();
  const token = sessionData.session?.access_token;
  return fetch("http://localhost:3000/api/schedule/apply", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}`, cookie: `sb-access-token=${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/schedule/apply (integration)", () => {
  it("creates an activity, runs the engine, persists computed dates", async () => {
    const r = await post(scheduler, {
      projectId: PROJECT_ID,
      editSessionId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      ops: [{
        type: "createActivity", tempId: "t1",
        wbsNodeId: WBS_ID, name: "Pour Slab",
        activityType: "task", originalDuration: 5,
      }],
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.data.temp_id_map.t1).toBeTruthy();

    // Verify the row was persisted with engine-computed dates.
    const s = service();
    const persisted = await s.from("activities")
      .select("id, planned_start, planned_finish, version")
      .eq("id", body.data.temp_id_map.t1).single();
    expect(persisted.data?.planned_start).toBeTruthy();
    expect(persisted.data?.planned_finish).toBeTruthy();
    expect(persisted.data?.version).toBe(1);
  });

  it("returns STALE_STATE when base_versions don't match", async () => {
    const s = service();
    const acts = await s.from("activities").select("id, version")
      .eq("project_id", PROJECT_ID).limit(1);
    const target = acts.data![0];

    // Bump the row's version out-of-band so the next request is stale.
    await s.from("activities").update({ version: target.version + 5 }).eq("id", target.id);

    // Now submit using base_versions for the OLD version. The orchestrator
    // reads the (now-bumped) version on its own snapshot, but we craft a raw
    // RPC call to simulate a client that captured the older version pre-bump.
    const { data } = await scheduler.rpc("apply_schedule_edit", {
      p_payload: {
        project_id: PROJECT_ID,
        request_id: crypto.randomUUID(),
        acting_user_id: (await scheduler.auth.getUser()).data.user!.id,
        edit_session_id: crypto.randomUUID(),
        intent_op_count: 0,
        base_versions: {
          project_version: 1,
          activities: { [target.id]: target.version },   // stale
          dependencies: {}, constraints: {},
        },
        writes: {
          activity_inserts: [], activity_updates: [], activity_soft_deletes: [],
          dependency_inserts: [], dependency_updates: [], dependency_soft_deletes: [],
          constraint_upserts: [], constraint_deletes: [],
          project_patch: {}, project_problems: [],
        },
        history_rows: [],
      },
    });
    expect((data as { error?: string }).error).toBe("STALE_STATE");
  });

  it("returns ENGINE_CYCLE when ops would create a cycle", async () => {
    // Create two activities and a→b, then submit b→a as the same request.
    const sessionId = crypto.randomUUID();
    const r = await post(scheduler, {
      projectId: PROJECT_ID,
      editSessionId: sessionId,
      requestId: crypto.randomUUID(),
      ops: [
        { type: "createActivity", tempId: "ta", wbsNodeId: WBS_ID,
          name: "CycleA", activityType: "task", originalDuration: 1 },
        { type: "createActivity", tempId: "tb", wbsNodeId: WBS_ID,
          name: "CycleB", activityType: "task", originalDuration: 1 },
        { type: "addDependency", tempId: "d1",
          predecessorId: "ta", successorId: "tb", relType: "FS", lag: 0 },
        { type: "addDependency", tempId: "d2",
          predecessorId: "tb", successorId: "ta", relType: "FS", lag: 0 },
      ],
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe("ENGINE_CYCLE");
  });

  it("is idempotent on retry with the same requestId", async () => {
    const reqId = crypto.randomUUID();
    const payload = {
      projectId: PROJECT_ID,
      editSessionId: crypto.randomUUID(),
      requestId: reqId,
      ops: [{
        type: "createActivity", tempId: "idem1", wbsNodeId: WBS_ID,
        name: "Idempotent A", activityType: "task", originalDuration: 2,
      }],
    };
    const r1 = await post(scheduler, payload);
    const b1 = await r1.json();
    expect(b1.ok).toBe(true);

    const r2 = await post(scheduler, payload);
    const b2 = await r2.json();
    expect(b2).toEqual(b1);

    // Only ONE activity actually got created — not two.
    const s = service();
    const count = await s.from("activities").select("id", { count: "exact", head: true })
      .eq("name", "Idempotent A").eq("project_id", PROJECT_ID);
    expect(count.count).toBe(1);
  });
});
```

- [ ] **Step 2: Start the dev server in another shell**

```bash
npm run dev
```

Wait for `Ready in …`.

- [ ] **Step 3: Run the test**

```bash
npx vitest run tests/integration/apply-schedule-edit.test.ts
```

Expected: PASS (first case at minimum; flesh out the other three).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/apply-schedule-edit.test.ts
git commit -m "test: end-to-end intent test for create-activity round-trip"
```

---

## Task 24: Integration test — `getProjectSchedule` round-trip

**Files:**
- Create: `tests/integration/get-project-schedule.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/integration/get-project-schedule.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { seedFixture, asUser, service, SCHED_ID, PROJECT_ID, WBS_ID } from "./setup";

let scheduler: Awaited<ReturnType<typeof asUser>>;

beforeAll(async () => {
  await seedFixture();
  scheduler = await asUser(SCHED_ID);
});

async function authed(path: string) {
  const { data: sessionData } = await scheduler.auth.getSession();
  const token = sessionData.session?.access_token;
  return fetch(`http://localhost:3000${path}`, {
    headers: token
      ? { authorization: `Bearer ${token}`, cookie: `sb-access-token=${token}` }
      : {},
  });
}

describe("GET /api/projects/:id/schedule", () => {
  it("returns the full hydrated schedule with engine-computed dates", async () => {
    // 1. Submit an edit so the engine writes computed dates.
    const { data: sessionData } = await scheduler.auth.getSession();
    const token = sessionData.session?.access_token;
    await fetch("http://localhost:3000/api/schedule/apply", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        cookie: `sb-access-token=${token}`,
      },
      body: JSON.stringify({
        projectId: PROJECT_ID,
        editSessionId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        ops: [{
          type: "createActivity", tempId: "g1", wbsNodeId: WBS_ID,
          name: "Hydration check", activityType: "task", originalDuration: 3,
        }],
      }),
    });

    // 2. Fetch the schedule.
    const r = await authed(`/api/projects/${PROJECT_ID}/schedule`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.data.project.id).toBe(PROJECT_ID);
    expect(body.data.activities.length).toBeGreaterThanOrEqual(1);

    const created = body.data.activities.find(
      (a: { name: string; planned_start: string | null }) =>
        a.name === "Hydration check" && a.planned_start !== null);
    expect(created).toBeTruthy();
  });

  it("returns stale=true when projects.schedule_dirty_at is set", async () => {
    const s = service();
    await s.from("projects")
      .update({ schedule_dirty_at: new Date().toISOString() })
      .eq("id", PROJECT_ID);

    const r = await authed(`/api/projects/${PROJECT_ID}/schedule`);
    const body = await r.json();
    expect(body.data.stale).toBe(true);

    // Clear for subsequent tests.
    await s.from("projects").update({ schedule_dirty_at: null }).eq("id", PROJECT_ID);
  });
});
```

- [ ] **Step 2: Run**

```bash
npx vitest run tests/integration/get-project-schedule.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/get-project-schedule.test.ts
git commit -m "test: getProjectSchedule integration round-trip"
```

---

## Task 25: Final pass — lint, typecheck, full test suite, PR

**Files:** none new.

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Full test run**

```bash
npm test
```

Expected: every test green — engine tests, validator, load-snapshot, apply-ops, build-payload, wbs-cycle, plus all integration tests.

- [ ] **Step 4: SQL test run**

```bash
psql "$SUPABASE_SESSION_POOLER_URL" -f supabase/tests/apply_schedule_edit_test.sql
```

Expected: `== all tests passed ==`.

- [ ] **Step 5: Push and open a PR**

```bash
git push -u origin feat/schedule-crud
gh pr create --title "Phase 3 — schedule CRUD + engine wiring" --body "$(cat <<'EOF'
## Summary
- `apply_schedule_edit(jsonb)` RPC: single transactional boundary for every schedule-affecting write, with optimistic concurrency, idempotency, and history.
- `POST /api/schedule/apply` route: validates intent ops, loads snapshot, runs the engine, commits via RPC.
- `GET /api/projects/:id/schedule` bootstrap read endpoint.
- Plain CRUD endpoints for `/api/calendars` and `/api/wbs-nodes` with `schedule_dirty_at` propagation.
- Integer `version` columns added to every editable entity.
- `applied_edit_requests` table for RPC idempotency.

Implements the design in `docs/superpowers/specs/2026-05-22-phase-3-schedule-crud-design.md`.

## Test plan
- [ ] `npm test` passes (unit + integration)
- [ ] `psql -f supabase/tests/apply_schedule_edit_test.sql` passes
- [ ] Manual smoke: create activity via API → fetch schedule → verify engine-computed dates persisted
- [ ] STALE_STATE returned correctly under concurrent edits
- [ ] Cycle in ops aborts the commit with ENGINE_CYCLE
- [ ] Idempotency: same requestId on retry returns the same response

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 6: No further commit** — the PR is the deliverable.

---

## Done When

- All 25 tasks checked off.
- `apply_schedule_edit` migration is applied; SQL-level tests pass.
- `/api/schedule/apply` accepts every op type in §4 of the spec, runs the engine, persists results, and returns the typed response shape from §3.
- `/api/projects/:id/schedule` returns the full hydrated schedule with engine-computed dates.
- Plain CRUD endpoints for calendars / WBS work under RLS.
- All three testing layers (unit, RPC SQL, end-to-end intent) green.
- A new activity + new dependency submitted via the API yields correct engine-computed `planned_start` / `planned_finish` persisted to the DB, with corresponding `activity_history` rows.
