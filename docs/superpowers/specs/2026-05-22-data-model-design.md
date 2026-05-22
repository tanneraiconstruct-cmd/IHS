# Data Model & Migrations — Design Spec (Section 2 / Phase 2)

> **Status:** Approved design. Implementation plan to follow via writing-plans.
> **Scope:** Phase 2 of the build roadmap in `docs/SCHEDULING-TOOL-PLAN.md` — the Postgres
> data model for every Section 2 entity, helper SQL functions, and the **full** Row Level
> Security capability matrix (Approach A).
> **Date:** 2026-05-22

---

## 1. Scope & Decisions

**In scope (Phase 2):**

- Supabase project initialized (`supabase init`) — the `supabase/` directory, migrations, seed.
- Postgres schema for all 23 tables covering every Section 2 entity.
- Helper SQL functions and the complete role→capability matrix from Section 4.3.
- RLS enabled on every table, with policies and a column-level trigger.
- Seed data and SQL verification proving the internal/external split with two test users.

**Out of scope (later phases):**

- No `@supabase/supabase-js` / `@supabase/ssr` packages, no Next.js client/server wiring — that
  is Phase 3 (Schedule CRUD + engine wiring).
- No cost fields on resources — deferred to the procurement planning pass.
- No incremental recalculation, no UI.

**Decisions locked during brainstorming:**

| Decision | Choice | Rationale |
|---|---|---|
| DB target | **Hosted Supabase project** | `supabase link` + `supabase db push`; verified with two test users. |
| RLS depth | **Approach A — full capability matrix** | Complete Section 4.3 matrix + column-level rules now, not a Phase-11 skeleton. |
| Cost fields | **Deferred** | Procurement is a later, separate planning pass. |
| Activity codes / tags | **Included** | Section 6 Gantt filters need them; cheap to add now. |
| Lookahead readiness flags | **Included** | Lightweight `constraints_cleared` bool + notes (Section 5.4). Full PPC still v2. |
| Baseline snapshot | **Included** | Core Section 2 entity; frozen activity-row copies. |
| Soft delete | **Yes** — `deleted_at` columns | Plan 2.5 + the standing no-permanent-deletion rule. Filtered at the query layer, not in RLS, so the audit trail still sees deleted rows. |
| Constraints | **Own table**, `unique(activity_id)` | Matches the entity map; the "one per activity" cap is easy to relax later. |
| Migrations | **Split thematically** | Keeps the schema and the security layer independently legible. |

**Patterns applied** (from the knowledge vault): `Patterns/Supabase RLS` — RLS enabled on every
table, never the `service_role` key in client code; `Patterns/Role-Based Permissions` — a
data-driven role→capability map with a least-privilege fallback for unknown roles.

---

## 2. Migration Layout

`supabase init` creates `supabase/`. Migration files are timestamped; logical names below:

| File | Contents |
|---|---|
| `001_core.sql` | Enums; `organizations`, `companies`, `users`, `memberships`, `projects`, `calendars`, `calendar_exceptions` |
| `002_schedule.sql` | `wbs_nodes`, `activities`, `dependencies`, `constraints`, `resources`, `resource_assignments`, `activity_codes`, `activity_code_assignments` |
| `003_collaboration.sql` | `baselines`, `baseline_activities`, `lookaheads`, `lookahead_tasks`, `comments`, `attachments`, `activity_history` |
| `004_rls_functions.sql` | `role_capabilities` table + matrix seed; helper functions; the external column-guard trigger function |
| `005_rls_policies.sql` | `ENABLE ROW LEVEL SECURITY` on all tables; policies; attach the trigger |
| `seed.sql` | Sample org / two companies / two users / project / calendar / activities for verification |

**Workflow:** `supabase link --project-ref <ref>` → `supabase db push` → run the verification
script against the hosted DB. Phase 2 is DB-only.

---

## 3. Enums

| Enum | Values |
|---|---|
| `company_type` | `internal`, `external` |
| `project_role` | `org_admin`, `project_admin`, `scheduler`, `project_manager`, `superintendent`, `internal_viewer`, `trade_partner_editor`, `trade_partner_viewer` |
| `project_status` | `planning`, `active`, `on_hold`, `complete`, `archived` |
| `activity_type` | `task`, `milestone`, `summary`, `level_of_effort` |
| `dependency_type` | `FS`, `SS`, `FF`, `SF` |
| `constraint_type` | `SNET`, `SNLT`, `FNET`, `FNLT`, `MSO`, `MFO`, `ALAP` |
| `resource_type` | `labor`, `equipment`, `material` |
| `comment_scope` | `project`, `activity` |
| `visibility` | `internal`, `shared` |
| `lookahead_source_mode` | `from_master`, `carry_forward` |

`lookahead.type` and `lookahead_task.status` are plain `text` (low-churn, not worth pinning).

**Engine reconciliation:** the CPM engine's `ActivityType` is only `task | milestone`. The DB
enum keeps all four values; the engine ignores `summary` rows (those are WBS rollups) and
`level_of_effort` is carried for completeness. This is intentional, not a mismatch to fix.

---

## 4. Table Catalog

All tables have `id uuid primary key default gen_random_uuid()` unless noted. All carry
`created_at timestamptz not null default now()`. Mutable entities additionally carry
`deleted_at timestamptz` (soft delete). FKs are `not null` unless marked nullable.

### 4.1 Core (`001_core.sql`)

**organizations** — top container.
`name text not null`.

**companies** — a firm; the internal/external coarse gate.
`organization_id → organizations`, `name text not null`, `type company_type not null`.

**users** — authenticated person; profile row.
`id uuid primary key references auth.users(id) on delete cascade` (no default — equals the
Supabase Auth id), `company_id → companies`, `full_name text not null`, `email text not null`,
`phone text`, `title text`.

**memberships** — user × project, carries the per-project role.
`user_id → users`, `project_id → projects`, `role project_role not null`.
`unique (user_id, project_id)`. Index `(user_id, project_id)`.

**projects** — top-level schedule container.
`organization_id → organizations`, `name text not null`, `number text`, `client text`,
`address text`, `status project_status not null default 'planning'`,
`planned_start date`, `planned_finish date`, `project_start date not null`,
`data_date date` (nullable — null = pure forecast),
`default_calendar_id → calendars` (**nullable**, set after the calendar row exists),
`critical_float_threshold integer not null default 0`,
`comment_visibility_default visibility not null default 'internal'`,
`change_event_visibility_default visibility not null default 'shared'`,
`deleted_at`.

**calendars** — working-time definition.
`project_id → projects`, `name text not null`,
`working_weekdays smallint[] not null default '{1,2,3,4,5}'` (JS `getUTCDay` values, 0=Sun),
`is_default boolean not null default false`.

**calendar_exceptions** — per-date overrides.
`calendar_id → calendars`, `exception_date date not null`, `working boolean not null`.
`unique (calendar_id, exception_date)`.

### 4.2 Schedule (`002_schedule.sql`)

**wbs_nodes** — hierarchical outline tree.
`project_id → projects`, `parent_id → wbs_nodes` (nullable — root nodes),
`name text not null`, `sort_order integer not null default 0`, `deleted_at`.

**activities** — the central unit of work. Stored inputs **and** the engine's computed cache.
*Inputs:* `project_id → projects`, `wbs_node_id → wbs_nodes` (nullable),
`name text not null`, `activity_type activity_type not null default 'task'`,
`original_duration integer not null default 0`, `remaining_duration integer not null default 0`,
`calendar_id → calendars` (nullable override), `actual_start date`, `actual_finish date`,
`percent_complete numeric(5,2) not null default 0`,
`responsible_company_id → companies` (nullable).
*Computed cache — mirrors the engine `ActivityResult` exactly:* `early_start date`,
`early_finish date`, `late_start date`, `late_finish date`, `planned_start date`,
`planned_finish date`, `total_float integer`, `free_float integer`,
`is_critical boolean not null default false`.
*Concurrency:* `version integer not null default 1`, `updated_at timestamptz not null default now()`.
`deleted_at`. Indexes: `(project_id)`, `(wbs_node_id)`.

**dependencies** — directed logic links.
`project_id → projects`, `predecessor_id → activities`, `successor_id → activities`,
`type dependency_type not null`, `lag integer not null default 0`,
`is_active boolean not null default true`, `deleted_at`.
`check (predecessor_id <> successor_id)`. Indexes `(predecessor_id)`, `(successor_id)`.

**constraints** — date restriction on one activity.
`activity_id → activities`, `type constraint_type not null`,
`constraint_date date` (nullable — ignored for `ALAP`).
`unique (activity_id)` (one per activity, v1).

**resources** — crew / labor / equipment / material.
`project_id → projects`, `name text not null`, `type resource_type not null`,
`unit text`, `calendar_id → calendars` (nullable override), `deleted_at`.
(No cost column — deferred.)

**resource_assignments** — activity ↔ resource join.
`activity_id → activities`, `resource_id → resources`,
`quantity numeric`, `allocation_percent numeric`, `deleted_at`.
`unique (activity_id, resource_id)`.

**activity_codes** — a tag value within a category.
`project_id → projects`, `category text not null` (e.g. "Trade", "Area"),
`value text not null`. `unique (project_id, category, value)`.

**activity_code_assignments** — activity ↔ code join.
`activity_id → activities`, `activity_code_id → activity_codes`.
`unique (activity_id, activity_code_id)`.

### 4.3 Collaboration (`003_collaboration.sql`)

**baselines** — named snapshot header.
`project_id → projects`, `name text not null`, `created_by → users`.

**baseline_activities** — frozen per-activity copy at baseline time.
`baseline_id → baselines`, `activity_id → activities`, `name text not null`,
`planned_start date`, `planned_finish date`, `original_duration integer not null`,
`percent_complete numeric(5,2) not null`.

**lookaheads** — short-term window.
`project_id → projects`, `name text not null`, `window_start date not null`,
`window_end date not null`, `type text`, `source_mode lookahead_source_mode not null default 'from_master'`,
`created_by → users`, `deleted_at`.

**lookahead_tasks** — detail/field task, optionally linked to a master activity.
`lookahead_id → lookaheads`, `master_activity_id → activities` (nullable — null = detached),
`name text not null`, `offset_start integer`, `offset_finish integer` (working-day offsets
from the master's computed dates; used when linked), `start_date date`, `finish_date date`
(explicit dates; used when detached), `crew text`,
`responsible_company_id → companies` (nullable), `status text`,
`percent_complete numeric(5,2) not null default 0`,
`constraints_cleared boolean not null default false`, `readiness_notes text`, `deleted_at`.

**comments** — human feed message.
`project_id → projects`, `author_user_id → users`, `body text not null`,
`parent_comment_id → comments` (nullable — threaded replies),
`scope comment_scope not null`, `target_activity_id → activities` (nullable; required when
`scope = 'activity'`), `visibility visibility not null`,
`edited_at timestamptz`, `deleted_at`.
`check (scope = 'activity') = (target_activity_id is not null)`.
Indexes `(project_id)`, `(target_activity_id)`.

**attachments** — files referenced by comments or activities.
`project_id → projects`, `comment_id → comments` (nullable),
`activity_id → activities` (nullable), `storage_path text not null`,
`file_name text not null`, `file_size bigint`, `content_type text`,
`uploaded_by → users`, `visibility visibility not null`, `deleted_at`.

**activity_history** — append-only audit log; the change-event source for the side-panel feed.
`project_id → projects`, `edit_session_id uuid` (nullable),
`entity_type text not null`, `entity_id uuid not null`, `field text not null`,
`old_value text`, `new_value text`, `changed_by → users`,
`changed_at timestamptz not null default now()`,
`visibility visibility not null`, `session_note text`.
Index `(project_id, entity_id)`. **No `deleted_at`** — append-only.

---

## 5. RLS & the Full Capability Matrix (Approach A)

### 5.1 `role_capabilities` table (`004_rls_functions.sql`)

The SQL analogue of the vault's `ROLE_PERMISSIONS` object.

```
role_capabilities (
  role       project_role not null,
  capability text         not null,
  scope      text         not null default 'all',   -- 'all' | 'responsible'
  primary key (role, capability)
)
```

A row's **presence** = the capability is granted. `scope = 'responsible'` encodes the
"limited"/"scoped" cells of the Section 4.3 matrix. Seeded directly from that matrix.

### 5.2 Capability list (14)

`view_schedule`, `edit_schedule`, `update_progress`, `manage_dependencies`,
`manage_baselines`, `create_lookahead`, `edit_lookahead_tasks`, `post_internal_comment`,
`post_shared_comment`, `view_internal_comments`, `enter_edit_mode`, `manage_members`,
`manage_calendars`, `soft_delete_activities`.

### 5.3 Matrix seed (from Section 4.3)

Legend: `A` = granted, scope `all`; `R` = granted, scope `responsible`; `—` = not granted.

| Capability | OrgAdmin | ProjAdmin | Scheduler | PM | Super | Int.Viewer | TP Editor | TP Viewer |
|---|---|---|---|---|---|---|---|---|
| view_schedule | A | A | A | A | A | A | A | A |
| edit_schedule | A | A | A | A | R | — | — | — |
| update_progress | A | A | A | A | A | — | R | — |
| manage_dependencies | A | A | A | A | — | — | — | — |
| manage_baselines | A | A | A | — | — | — | — | — |
| create_lookahead | A | A | A | A | A | — | — | — |
| edit_lookahead_tasks | A | A | A | A | A | — | R | — |
| post_internal_comment | A | A | A | A | A | A | — | — |
| post_shared_comment | A | A | A | A | A | A | A | — |
| view_internal_comments | A | A | A | A | A | A | — | — |
| enter_edit_mode | A | A | A | A | R | — | R | — |
| manage_members | A | A | — | — | — | — | — | — |
| manage_calendars | A | A | A | — | — | — | — | — |
| soft_delete_activities | A | A | A | — | — | — | — | — |

**`view_schedule` resolution:** external roles get scope `all` — external members read the
**full** master schedule (Section 4.4 Model A, the recommended model). The internal/external
data boundary is enforced **solely** by the comment/history visibility policies; schedule rows
themselves are not filtered by company type.

### 5.4 Helper functions (`SECURITY DEFINER`)

Defined `SECURITY DEFINER` so policies stay thin and avoid recursive RLS evaluation (plan 4.5).

| Function | Returns | Behaviour |
|---|---|---|
| `current_company_type()` | `company_type` | Company type of `auth.uid()`'s user; `null` if none (e.g. `service_role`). |
| `is_member(p_project uuid)` | `boolean` | A `memberships` row exists for `auth.uid()` on the project. |
| `role_on(p_project uuid)` | `project_role` | The caller's role on the project; `null` if not a member. |
| `has_capability(p_capability text, p_project uuid, p_is_responsible boolean default false)` | `boolean` | Joins `role_on()` to `role_capabilities`; true only when the grant's scope is satisfied (`'all'`, or `'responsible'` with `p_is_responsible`). **No row → false** (least-privilege fallback). |
| `is_responsible(p_activity uuid)` | `boolean` | Caller's `company_id` == the activity's `responsible_company_id`. |

> **Implementation note:** the originally-planned separate `can()` and `cap_scope()` helpers were consolidated into the single `has_capability()` above. A capability granted with `scope = 'responsible'` must not pass a plain existence check, so scope is folded into one mandatory check rather than left to a caller who might invoke `can()` alone.

### 5.5 Policies (`005_rls_policies.sql`)

`ENABLE ROW LEVEL SECURITY` on **all 23 tables**. Per-table SELECT/INSERT/UPDATE/DELETE
policies built from the helpers. Representative policies:

- **projects** — SELECT `is_member(id)`; UPDATE `has_capability('manage_members', id)`.
- **activities** — SELECT `is_member(project_id)`; INSERT `has_capability('edit_schedule', project_id)`;
  UPDATE `has_capability('edit_schedule', project_id, is_responsible(id)) OR has_capability('update_progress', project_id, is_responsible(id))`
  (external column scope enforced by the trigger, §5.6). **No hard DELETE policy** — soft-delete is an `UPDATE` of `deleted_at`. The `soft_delete_activities` capability is *not* enforced at the RLS layer: distinguishing which internal roles may set `deleted_at` is a column-level rule, deferred to the Phase 3 server layer per the §5.6 principle that column-level distinctions among trusted internal roles live in the server (only the external boundary is enforced in-DB).
- **dependencies** — writes gated by `has_capability('manage_dependencies', project_id)`.
- **comments** — SELECT `is_member(project_id) AND (visibility = 'shared' OR current_company_type() = 'internal')`;
  INSERT `WITH CHECK` the same visibility rule plus `has_capability('post_internal_comment'|'post_shared_comment', project_id)`.
- **activity_history** — SELECT same internal/shared rule as comments; INSERT allowed for members.
  **No UPDATE or DELETE policy** → append-only (the vault audit-log pattern).
- **memberships** — SELECT own rows or `has_capability('manage_members', project_id)`; writes admins only.
- Child tables (`calendar_exceptions`, `baseline_activities`, `resource_assignments`,
  `activity_code_assignments`, `lookahead_tasks`, `attachments`) inherit access by joining to
  their parent's project and the matching capability.

### 5.6 Column-level enforcement — external progress-only trigger

RLS is row-level only. A `BEFORE UPDATE` trigger on `activities` enforces "an external editor
may change **progress fields only**":

- If `current_company_type() = 'external'`, the update is rejected unless every changed column
  is in the permitted set: `percent_complete`, `actual_start`, `actual_finish`,
  `remaining_duration`, `version`, `updated_at`.
- Internal users and `service_role` (server recalc — `current_company_type()` is `null`) pass
  through unaffected.

The plan flags column-level rules as server-layer work; since Approach A was chosen and the
Phase 3 server layer does not exist yet, the trigger is the correct DB-level home for it now.

---

## 6. Seed Data (`seed.sql`)

For verification: one `organization`; one `internal` company + one `external` company; two
users (rows in `auth.users` **and** `users`); one `project` with a default `calendar` plus one
holiday `calendar_exception`; a small `wbs_nodes` tree; a few `activities` (one with the
external company as `responsible_company_id`) and one `dependency`; one `internal` comment and
one `shared` comment. Memberships: internal user = **scheduler**, external user =
**trade_partner_editor**.

---

## 7. Verification & Testing

Phase 2 done-criteria: *migrations apply cleanly; RLS proven with two test users.*

Verification is a SQL script at `supabase/tests/rls_verification.sql`, run against the hosted
DB with `psql`. Each check runs in its own transaction, uses `SET LOCAL request.jwt.claims` /
`SET LOCAL ROLE authenticated` to impersonate a user, and `RAISE EXCEPTION` on a failed
assertion (zero external test-framework dependency). Checks:

1. `supabase db push` (or `db reset` locally) applies all migrations + seed with no error.
2. External TP Editor **cannot** `SELECT` the `internal` comment; **can** see the `shared` one.
3. External TP Editor **can** `UPDATE percent_complete` on their responsible activity;
   **cannot** `UPDATE original_duration` on it (trigger rejects);
   **cannot** `UPDATE` a non-responsible activity at all (policy rejects).
4. Scheduler **can** edit logic/durations; Trade Partner Viewer is read-only;
   a non-member `SELECT` returns nothing.
5. `activity_history` rejects `UPDATE` and `DELETE`.

---

## 8. Execution Dependencies

- A hosted Supabase project — its **project ref** and **database password** are required for
  `supabase link` / `supabase db push`. To be supplied at implementation time.
- Supabase CLI v2.101.0 — already installed.
- The two seed users require rows in `auth.users`; seed inserts them directly (with fixed
  UUIDs) so the verification script can impersonate them deterministically.
