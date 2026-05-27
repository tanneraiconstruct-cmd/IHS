# Scheduling Software — Planning & Architecture Spec

> **Status:** Planning only. This document is the consolidated specification to bring into Claude Code for implementation. No application code is written during this planning phase.
>
> **Reference model:** Procore Scheduling (master Gantt + Lookahead) and the Outbuild/ProPlanner integration pattern. We are building a similar UI/UX and feature set for internal use, with a connected procurement module to follow later.
>
> **Last updated:** 2026-05-21

---

## Table of Contents (Section Roadmap)

0. Overview, Goals & Reference Model
1. Architecture & System Overview ✅
2. Domain Model & Core Concepts ✅
3. The CPM Scheduling Engine (forward/backward pass, float, dependency types, lags, constraints, calendars) ✅
4. Permissions & the Internal/External Split (roles, RLS policies) ✅
5. The Lookahead Module (field tasks linked to master activities) ✅
6. UI & Component Breakdown (Gantt, list, calendar, interactive editing) ✅
7. API Design & Real-Time Collaboration (endpoints, sync, conflict resolution) ✅
8. Phased Build Roadmap (the order to build in Claude Code) ✅

*Then: Procurement Management planning pass (hooks into this foundation).*

---

## Section 0 — Overview, Goals & Reference Model

**Goal:** Build a fully integrated construction scheduling tool with a Procore-style UI, then layer a procurement management tool on top of the same foundation. This phase plans the scheduling tool only.

**Core experience we're mirroring (from Procore + Outbuild):**

- A **master Project Schedule** rendered as an interactive Gantt chart.
- Direct **on-chart editing**: drag a bar to move/resize it, drag to set percent-complete, draw/deactivate dependency links.
- **Critical path** visualization (toggle on/off).
- **Baselines** for comparing planned vs. actual.
- A **Lookahead module**: short-term (1–6 week) execution windows where field/detail tasks stay linked to master activities and auto-shift when the master moves.
- **Multiple views**: Gantt, list/table, calendar (day/week/month).
- **Real-time multi-user collaboration** with conflict resolution.
- **Import/sync** from MS Project (.MPP) and Primavera P6 (.XER) — likely a later phase.

**Two audiences (key requirement):** an **internal** view (full team) and an **external** view (trade partners / collaborators), with role-based permissions governing what each side sees and can do.

---

## Section 1 — Architecture & System Overview

### Tech Stack (confirmed)

**Next.js (React + TypeScript) on Cloudflare Workers · Supabase (Postgres + Auth + Realtime + RLS + Storage) · GitHub (repo + CI/CD)**

| Concern | Owned by | Notes |
|---|---|---|
| UI / rendering | Next.js + React (TS) | Gantt, list, calendar, lookahead views |
| Backend logic | Next.js server actions / route handlers (on Cloudflare Workers via @opennextjs/cloudflare) | Validation, orchestration, runs the CPM engine authoritatively |
| Database | Supabase Postgres | Relational schedule data; recursive queries for dependency chains |
| Auth | Supabase Auth | Users, sessions, JWTs; internal + external login flows |
| Permissions | Supabase Row Level Security (RLS) | Row-level enforcement — replaces hand-rolled API guards |
| Real-time collaboration | Supabase Realtime | Streams Postgres changes to connected clients |
| File storage | Supabase Storage | Attachments, imported schedule files |
| CI/CD | GitHub → Cloudflare Workers Builds | Preview deploys per PR, prod on merge to main |
| Gantt rendering | TBD in Section 6 | Build-vs-buy decision (e.g., dhtmlx-gantt / frappe-gantt / svar-gantt / custom SVG-Canvas) |

### The CPM Engine placement

- The **CPM engine is a pure, framework-agnostic TypeScript module** in the repo — deterministic, stateless, independently testable, and **shared between client and server**.
- **Authoritative recalculation** runs in a Next.js server action / route handler on Cloudflare Workers.
- The **client runs the same engine locally** for instant optimistic preview, then reconciles with the authoritative server result.
- **Watch-item:** very large schedules (thousands of activities) could approach serverless function time limits. Escape hatch: Supabase Edge Function or dedicated recalc endpoint. Not a v1 concern.

### Recalculation model: **server-authoritative + optimistic client prediction**

Single-edit flow:

1. User drags a bar → client runs the engine locally and re-renders instantly (optimistic).
2. Client sends the *intent* ("move activity 42 to May 25") to a server action.
3. Server validates the action against RLS-backed permissions.
4. Engine recalculates the affected slice of the schedule.
5. Result is persisted to Supabase Postgres in a transaction.
6. Supabase Realtime pushes the changes to other connected users.
7. Each client reconciles its local prediction with the authoritative result.

### Internal vs. external at the architecture level

Both audiences hit the **same** Next.js app, the **same** database, and the **same** engine. The difference is enforced at the **RLS / authorization layer** and in **what data is returned/accepted** — not in separate codebases. External users get a permission-scoped, filtered view of the same underlying schedule. (Full role matrix in Section 4.)

**Tradeoff flagged:** RLS policies get intricate with nested internal/external roles. The role model in Section 4 must be designed so policies stay maintainable.

---

## Section 2 — Domain Model & Core Concepts

This section defines every entity, what it means, and how the entities relate. These map directly to Postgres tables. Field lists are indicative (the authoritative schema/migrations get finalized in Claude Code), but the relationships and meanings are the decisions we're locking in here.

### 2.1 The entity map (at a glance)

```
Organization
  └─ Company (internal "owner" company + external trade-partner companies)
       └─ User ──< Membership >── Project        (role per user per project)
Project
  ├─ Calendar (one or more; one is the project default)
  ├─ WBS node (hierarchical tree)
  │     └─ Activity (the core unit of work)
  │            ├─ Dependency (predecessor/successor relationships)
  │            ├─ Constraint (date constraints: SNET, FNLT, MSO, etc.)
  │            ├─ ResourceAssignment ──> Resource
  │            └─ Attachment
  ├─ Baseline (named snapshot of all activities at a point in time)
  ├─ Lookahead (short-term window)
  │      └─ LookaheadTask ──> (links to a master Activity)
  └─ ActivityFeed (the side-panel feed)
         ├─ FeedEntry: Comment   (human; visibility = internal | shared)
         └─ FeedEntry: ChangeLog (system; emitted by Edit Mode, from ActivityHistory)
```

### 2.2 Core entities

**Organization** — top container (your business). In a single-org internal tool this may be implicit/one row, but modeling it keeps the door open for multi-org later.

**Company** — a firm. Two flavors via a `type` field: `internal` (the GC / owner running the tool) and `external` (trade partners, subs). Drives the internal/external split — a user's company type is a primary input to permissions.

**User** — an authenticated person (backed by Supabase Auth). Belongs to one Company. Profile fields (name, email, phone, title).

**Membership** — the join between a User and a Project, carrying that user's **role on that project** (e.g., Scheduler, Superintendent, Trade Partner, Viewer). This is the linchpin of permissions: roles are *per-project*, not global, so the same person can be a Scheduler on one project and a Viewer on another. Detailed in Section 4.

**Project** — the top-level schedule container. Holds metadata (name, number, client, address, status, planned start/finish), a default Calendar, and a `data_date` (the "as-of" date used by the CPM engine to separate actuals from forecast).

**Calendar** — defines working time: working days of the week, working hours per day, and exceptions (holidays, non-work days, special workdays). The CPM engine uses calendars to convert durations into real start/finish dates. A project has a default calendar; individual activities or resources may override it.

**WBS node (Work Breakdown Structure)** — the hierarchical outline that organizes activities into a tree (e.g., Phase → Area → System). Self-referencing parent/child. Provides the expand/collapse hierarchy seen in the Procore Gantt. Summary-level rollups (dates, % complete) are computed from child activities.

**Activity (Task)** — the central unit of work. Key fields:
- `name`, `wbs_node_id`, `activity_type` (task, milestone, summary, level-of-effort)
- `original_duration`, `remaining_duration`
- `planned_start`, `planned_finish` (computed by the engine)
- `actual_start`, `actual_finish` (entered as work progresses)
- `percent_complete`
- `calendar_id` (override; else inherits project default)
- `total_float`, `free_float` (computed)
- `is_critical` (computed)
- `responsible_party` / assigned company (drives who can edit in the field & external visibility)

**Dependency (Relationship / Logic link)** — directed link between a predecessor Activity and a successor Activity. Fields:
- `predecessor_id`, `successor_id`
- `type`: one of **FS** (Finish-to-Start), **SS** (Start-to-Start), **FF** (Finish-to-Finish), **SF** (Start-to-Finish)
- `lag` (positive or negative duration offset)
- `is_active` (deactivated links render as dashed lines and don't drive logic — matches Procore behavior)
These define the network the CPM engine traverses. (The math is Section 3.)

**Constraint** — a date restriction on a single Activity that limits how the engine can schedule it. Common types: Start No Earlier Than (SNET), Start No Later Than (SNLT), Finish No Earlier Than (FNET), Finish No Later Than (FNLT), Must Start On (MSO), Must Finish On (MFO), As Late As Possible (ALAP). Constraints interact with float and can create negative float — handled in Section 3.

**Resource** — a crew, labor type, equipment, or material that can be assigned to activities. Fields: `name`, `type` (labor/equipment/material), `unit`, optional cost rate, optional own calendar. Enables resource loading and (later) leveling.

**ResourceAssignment** — join between Activity and Resource: how much of a resource an activity consumes (units/quantity, allocation %). Basis for resource histograms and over-allocation detection.

**Baseline** — a named, frozen snapshot of all activities (planned dates, durations) at a point in time. Used for variance comparison ("Compare to Latest Master" / planned-vs-actual). Stored as a copy so the live schedule can move while the baseline stays fixed.

**Lookahead** — a short-term planning window (1–6 weeks) tied to a date range. Belongs to a Project. (Full behavior in Section 5.)

**LookaheadTask** — a detail/field task within a Lookahead that **links to a master Activity**. When the master activity shifts, linked lookahead tasks shift with it. Can also hold extra field-level breakdown not present in the master schedule.

**Comment** — a human-authored message in the side-panel feed. Key fields:
- `body`, `author_user_id`, `created_at`, optional `parent_comment_id` (threaded replies)
- `scope`: either `project` (general discussion) or `activity` (attached to a specific Activity)
- `target_activity_id` (when `scope = activity`)
- **`visibility`**: `internal` (only internal-company users can see/read) or `shared` (visible to internal **and** external trade-partner users). This is the internal/external comment toggle and is enforced by RLS in Section 4.
- optional `mentions` (user references for notifications), optional attachments

**Attachment** — files (notes, photos, docs) referenced by comments or activities. Stored in Supabase Storage; rows hold metadata + storage path. Inherit the visibility of their parent comment when posted in the feed.

**ActivityHistory (Audit log)** — append-only record of who changed what and when (entity, field, old value, new value, user, timestamp, `edit_session_id`). It is the **source of truth for change logging**; the side-panel feed renders system "change" entries directly from it. Always written on every mutation regardless of whether Edit Mode is on.

**FeedEntry (unified side-panel item)** — the panel is a single chronological stream built from two sources: **Comment** rows (human) and **ActivityHistory** rows surfaced as **system change events**. A `type` discriminator (`comment` | `change`) lets the UI render them differently. The feed is filterable by scope (whole project vs. a selected activity), by visibility (internal-only vs. shared), and by type (comments only / changes only / all).

### 2.3 Concepts that are computed, not stored as source-of-truth

These are **derived by the CPM engine** and cached on the activity rows for fast rendering, but the engine is always the authority:

- `planned_start` / `planned_finish` (from durations + logic + calendars + constraints + data date)
- `total_float`, `free_float`
- `is_critical` (total float ≤ 0, by default)
- WBS summary rollups (earliest child start → latest child finish, weighted % complete)

This separation matters: **stored inputs** (durations, logic, constraints, actuals, calendars) vs. **computed outputs** (dates, float, critical path). Section 3 defines exactly how outputs are produced from inputs.

### 2.4 Collaboration: the side-panel feed & Edit Mode

A persistent **side panel** sits beside the Gantt/list views and serves as the project's collaboration and change-history hub. It combines two things into one chronological feed:

1. **Comments** — human messages, postable at the **project level** (general discussion) or against a **selected activity**. Every comment carries a **visibility** setting:
   - **Internal** — visible only to users whose Company `type = internal`. Used for internal coordination the trade partners shouldn't see.
   - **Shared** — visible to internal users *and* external trade partners. Used for cross-party communication.
   The author picks visibility when posting (default proposed: **internal**, so nothing is exposed externally by accident). Enforcement is at the database via RLS (Section 4), not just hidden in the UI — an external user literally cannot query an `internal` comment.

2. **Change events** — system-generated entries describing edits to the schedule (e.g., *"Moved 'Pour Slab' start May 24 → May 27"*, *"Duration 5d → 7d"*, *"Added FS dependency to 'Strip Forms'"*). These are rendered from `ActivityHistory`.

**Edit Mode (the Edit button):**

- A toggle that puts the user into an explicit editing session. Clicking **Edit** starts an **edit session** (`edit_session_id`) and visibly indicates you're now mutating the schedule (e.g., banner + cursor/affordances change). Clicking **Done/Save** ends the session.
- While in Edit Mode, **every mutating change** (move/resize a bar, change dates or duration, add/remove/deactivate a dependency, add/delete an activity, change % complete, etc.) is captured to `ActivityHistory` tagged with that `edit_session_id`, and **surfaces in the side-panel feed as a change event**.
- **Session grouping (recommended):** because a single drag can produce many cascading recalculated dates, the feed groups all changes from one edit session under a collapsible header (*"Tanner made 6 changes · May 21, 2:14 PM"*) rather than spamming one line per micro-edit. The user can expand to see each individual change. This keeps the feed readable.
- **Optional session note:** on **Done/Save**, prompt the user for an optional one-line summary ("Re-sequenced concrete to fit inspection") that becomes the header for that grouped change set — gives human context to a machine-generated list.
- **Change-event visibility:** decide whether change events default to `internal` or `shared` (see open decisions). Recommendation: change events follow a per-project setting, defaulting to **shared** for transparency with trade partners, with the ability to mark a session internal.

**Why route changes through Edit Mode rather than logging silently?** Two reasons: (1) it makes editing an intentional, visible act (reduces accidental drags moving the schedule), and (2) it cleanly separates "I'm reading/coordinating" from "I'm changing the plan," which maps perfectly onto the role permissions in Section 4 — only roles with edit rights can enter Edit Mode at all. Note that `ActivityHistory` is still written on *any* mutation for audit integrity; Edit Mode governs the *UI affordance and feed presentation*, not whether auditing happens.

**Notifications (preview):** `@mentions` and replies can trigger notifications; shared-visibility items can notify external partners while internal items never do. Detailed alongside permissions in Section 4.

### 2.5 Open decisions to revisit

- **Soft vs. hard delete** for activities/dependencies (recommend soft-delete + audit, given the prohibition on permanent deletions and the need for history).
- **Multi-calendar granularity** — activity-level and resource-level calendar overrides, or project-level only for v1.
- **Cost fields** — include basic cost on resources now (helps procurement integration later) or defer entirely.
- **Activity codes / custom fields** — Procore/P6 support arbitrary tagging (trade, area, responsibility) used for filtering. Recommend a flexible `activity_code` / tag model so the Gantt filters in Section 6 are powerful.
- **Default comment visibility** — internal vs. shared as the default when posting (recommend **internal** to avoid accidental exposure).
- **Change-event visibility default** — should auto-logged schedule changes default to `internal` or `shared`? (Recommend a per-project setting, default **shared** for trade-partner transparency, overridable per edit session.)
- **Edit Mode required for edits?** — Should all schedule edits *require* entering Edit Mode (safer, more deliberate), or can quick edits happen inline outside a session (faster)? (Recommend: edits only inside Edit Mode for v1.)
- **Editing/deleting comments** — allow authors to edit/delete their own comments, and how that interacts with the append-only audit trail (recommend soft-delete/edit with history preserved).

---

## Section 3 — The CPM Scheduling Engine

### 3.0 Plain-language summary (read this first)

CPM = **Critical Path Method**, the standard math behind professional schedulers (Primavera P6, MS Project, Procore's Gantt). You don't hand-place every bar; you give the engine the *logic* ("can't pour the slab until forms are built") plus how long each task takes, and the engine **calculates all the dates**. When one thing moves, everything downstream recalculates — that's why dragging a bar in Procore shifts the linked bars automatically.

It does this in two passes:
- **Forward pass** → the *earliest* each activity can start/finish (walk the chain front-to-back).
- **Backward pass** → the *latest* each activity can start/finish without delaying the project (walk back-to-front).

The gap between earliest and latest is **float** (slack). Activities with **zero float** are the **critical path** — delay them and the whole project slips.

The engine is the **brain of the tool**: a pure TypeScript module that takes inputs (activities, durations, dependencies, calendars, constraints, the data date) and returns outputs (start/finish dates, float, critical-path flags). Everything else — Gantt, lookaheads, comments — sits on top of the dates it produces.

### 3.1 Inputs and outputs (the contract)

**Inputs (stored source-of-truth):**
- Activities: `id`, `original_duration`, `remaining_duration`, `calendar_id`, `activity_type` (task/milestone/LOE), progress fields (`actual_start`, `actual_finish`, `percent_complete`)
- Dependencies: `predecessor_id`, `successor_id`, `type` (FS/SS/FF/SF), `lag`, `is_active`
- Constraints: per-activity date restrictions (SNET, SNLT, FNET, FNLT, MSO, MFO, ALAP)
- Calendars: working days/hours + exceptions, per project (with activity/resource overrides)
- `data_date`: the "as-of" line separating completed work (left) from forecast (right)

**Outputs (computed, cached on rows):**
- `early_start (ES)`, `early_finish (EF)`, `late_start (LS)`, `late_finish (LF)`
- `planned_start` / `planned_finish` (the dates the Gantt draws — normally ES/EF)
- `total_float`, `free_float`
- `is_critical`
- Project computed finish date, and a list of detected problems (cycles, constraint conflicts, open ends)

The engine is **pure and deterministic**: same inputs → same outputs, no DB or network calls inside it. This is what makes it unit-testable and reusable on both client (optimistic preview) and server (authoritative result).

### 3.2 The activity network as a graph

The activities + active dependencies form a **directed acyclic graph (DAG)**. The engine:
1. Builds the graph from active dependencies (inactive links are ignored — they render dashed but don't drive logic).
2. **Detects cycles** (e.g., A→B→A). A cycle makes CPM unsolvable, so the engine must detect it, refuse to produce dates for the looped portion, and return a clear error identifying the loop so the UI can flag it. (P6/MS Project do the same.)
3. **Topologically sorts** the graph so the forward pass visits every predecessor before its successors, and the backward pass visits every successor before its predecessors.

Complexity is **O(V + E)** (activities + dependencies) per pass — fast even for large schedules.

### 3.3 Duration & calendar math (working-time arithmetic)

All date arithmetic is **calendar-aware** — you can't just add days, because weekends/holidays aren't work days. The engine needs helper functions:
- `addWorkingTime(date, duration, calendar)` → advances a date by N working units, skipping non-work days.
- `subtractWorkingTime(date, duration, calendar)` → the reverse, used in the backward pass.
- `workingTimeBetween(start, finish, calendar)` → measures working duration between two dates.

Decisions:
- **Granularity: DAY-BASED ✅ (CONFIRMED).** The engine schedules in whole working days for v1 (matches construction look-ahead practice and keeps the calendar math simpler). The calendar helpers must be written so hour-based granularity can be added later **without** rewriting the engine — i.e., keep a single "working-unit" abstraction rather than hard-coding "days" everywhere.
- **Which calendar governs a relationship's lag?** Convention (P6 default): the **successor's** calendar, or a designated relationship calendar. *Recommendation: successor calendar for v1.*

### 3.4 Forward pass (earliest dates)

Process activities in topological order. For an activity with no predecessors, ES = project start (or its constraint). Otherwise ES is driven by **each** incoming active relationship; take the **latest** requirement across all of them:

- **FS** (Finish→Start): successor ES ≥ predecessor EF + lag
- **SS** (Start→Start): successor ES ≥ predecessor ES + lag
- **FF** (Finish→Finish): successor EF ≥ predecessor EF + lag → back-solve ES
- **SF** (Start→Finish): successor EF ≥ predecessor ES + lag → back-solve ES

Then `EF = addWorkingTime(ES, remaining_duration, calendar)`. Milestones have zero duration (EF = ES). The **project early finish** is the maximum EF across all activities.

Lag is applied in working time and may be **negative** (a lead), which lets a successor start before its predecessor finishes.

### 3.5 Backward pass (latest dates)

Process in reverse topological order. Seed each open-ended activity's LF with the **project finish** (or its own finish constraint). For each predecessor, take the **earliest** requirement (most restrictive) across all outgoing relationships:

- **FS:** predecessor LF ≤ successor LS − lag
- **SS:** predecessor LS ≤ successor LS − lag → solve LF
- **FF:** predecessor LF ≤ successor LF − lag
- **SF:** predecessor LS ≤ successor LF − lag → solve LF

Then `LS = subtractWorkingTime(LF, remaining_duration, calendar)`.

### 3.6 Float & the critical path

- **Total float** = LS − ES (= LF − EF). How long an activity can slip without delaying the **project finish**.
- **Free float** = how long it can slip without delaying **any successor's** early start. (= min successor ES − this activity's EF, in working time.)
- **Critical** = `total_float ≤ 0` (threshold configurable; default 0). The critical path is the connected chain of critical activities — what the Gantt highlights when "Toggle Critical Path" is on.

Float can go **negative** when a constraint or deadline can't be met given the logic — that's the engine telling you the schedule is infeasible as drawn. Negative float must surface visibly in the UI.

### 3.7 Constraints (and how they bend the passes)

Constraints clamp the computed dates:
- **SNET / FNET** (no earlier than) raise ES/EF in the forward pass.
- **SNLT / FNLT** (no later than) lower LS/LF in the backward pass and can create negative float.
- **MSO / MFO** (must start/finish on) pin a date in both passes — the strongest, most likely to create negative float; use sparingly.
- **ALAP** (as late as possible) flips an activity to be driven from the backward pass.

Decision: **hard vs. soft constraints** — does a "must finish on" *override* the logic (hard) or just flag a violation (soft)? *Recommendation: soft + visible warning for v1*, so the engine never silently produces dates that contradict the network logic.

### 3.8 Progress, the data date, and re-forecasting

Once work starts, the engine schedules around the **data date**:
- Activities **complete** (100%) sit entirely left of the data date using their `actual_start`/`actual_finish`; they no longer move.
- **In-progress** activities use `actual_start` (fixed) and schedule their **remaining_duration** forward from the data date.
- **Not-started** activities are forecast normally but can't be scheduled before the data date.
- **Retained logic vs. progress override:** when an activity is progressed "out of sequence" (started before its predecessor finished), the engine needs a rule. *Recommendation: retained logic for v1* (remaining work still respects the predecessor) — note it as configurable later.

This is what makes the schedule a living forecast rather than a static plan, and it feeds baseline-vs-actual variance (Section 2 Baselines).

### 3.9 WBS summary rollups

Summary/WBS rows are **computed, not edited**: start = earliest child ES, finish = latest child EF, % complete = duration-weighted (or cost-weighted) average of children. Rolled up after the passes complete.

### 3.10 Incremental recalculation (performance + optimistic UI)

A full recalc is O(V+E) and fine for most schedules, but for snappy editing the engine should support recomputing only the **affected slice**: when activity X changes, only X and its **downstream successors** (and their float dependents) need re-evaluation. Plan:
- v1: full recalc on each change (simplest, correct, fast enough for typical schedules).
- v1.1: dirty-subgraph incremental recalc if large schedules feel sluggish.

The same module powers the **client optimistic preview** (instant local recalc on drag) and the **server authoritative recalc** (Section 1 flow). Because it's the identical code, the prediction and the truth can't diverge in logic.

### 3.11 Proposed module shape (conceptual, not code yet)

```
schedule-engine/            // pure TS, no DB/HTTP imports
  calendar.ts               // addWorkingTime / subtractWorkingTime / workingTimeBetween
  graph.ts                  // build graph, cycle detection, topological sort
  forwardPass.ts            // ES/EF
  backwardPass.ts           // LS/LF
  float.ts                  // total/free float, critical flagging
  constraints.ts            // apply constraint clamps
  progress.ts               // data-date / actuals handling
  index.ts                  // calculate(scheduleInput) -> scheduleResult
```

`calculate(input)` returns `{ activities: [{id, ES, EF, LS, LF, totalFloat, freeFloat, isCritical}], projectFinish, problems: [...] }`.

### 3.12 Testing strategy (this section is correctness-critical)

- **Unit tests per relationship type** (FS/SS/FF/SF) with and without lag, including negative lag.
- **Golden-master tests:** build small known schedules by hand, assert exact ES/EF/LS/LF/float. Where possible, cross-check a few against MS Project / P6 outputs.
- **Cycle detection tests:** assert loops are caught and reported, not silently mis-scheduled.
- **Constraint tests:** each constraint type, including negative-float cases.
- **Calendar tests:** weekends/holidays, multi-calendar, lag-across-calendar.
- **Progress tests:** data-date behavior, in-progress remaining duration, out-of-sequence/retained logic.
- **Property test:** randomized DAGs — assert invariants (EF ≥ ES, LF ≥ LS, critical chain is continuous, project finish = max EF).

### 3.13 Open decisions to revisit

- ~~Day-based vs. hour-based scheduling granularity~~ → **DECIDED: day-based for v1** (helpers built for future hour-based extensibility).
- Which calendar governs relationship lag (recommend successor calendar).
- Hard vs. soft constraints (recommend soft + warning for v1).
- Retained logic vs. progress override default (recommend retained logic).
- Critical-path definition: total float ≤ 0 vs. ≤ a configurable threshold (recommend 0, configurable).
- Whether to compute resource leveling now or defer (recommend defer past v1 — leveling is a large additional algorithm).

---

## Section 4 — Permissions & the Internal/External Split

### 4.0 Plain-language summary

There are two kinds of people in the tool: **internal** (your company — schedulers, PMs, supers) and **external** (trade partners/subs). Everyone can be given a **role on each project** that decides what they can see and do. The rules aren't just hidden in the screens — they're enforced **inside the database** using Supabase Row Level Security (RLS), so even if someone tried to go around the app, the database itself won't hand over data they aren't allowed to see. Think of it as three locked doors: the UI hides what you can't use, the server double-checks every change, and the database refuses anything that slips through.

### 4.1 Principles

- **Per-project roles.** Permissions live on the `Membership` row (User × Project), not globally. The same person can be a Scheduler on Project A and a Viewer on Project B.
- **Company type is the coarse gate.** `Company.type` (`internal` | `external`) is the first filter; the project role refines it.
- **Defense in depth (3 layers):** (1) UI hides/disables controls the role can't use; (2) server actions re-check permission before any mutation; (3) **RLS is the source of truth** — the database enforces row access regardless of how it's queried.
- **Least privilege by default.** New members default to the most restrictive sensible role; visibility defaults to internal.

### 4.2 Role catalog

**Internal roles**

| Role | Intended for | Core capability |
|---|---|---|
| Org Admin | Company owner/admin | Everything across all projects; manage companies & users |
| Project Admin | Project lead | Full control of one project incl. members, calendars, baselines |
| Scheduler | Planner | Full schedule edit: activities, logic, durations, constraints, baselines |
| Project Manager | PM | Edit schedule + progress + comments; usually no member management |
| Superintendent | Field lead | Update progress/actuals, build & edit lookaheads, comment; limited logic edits |
| Internal Viewer | Office staff/owner | Read-only across the whole project, sees internal + shared comments |

**External roles**

| Role | Intended for | Core capability |
|---|---|---|
| Trade Partner Editor | Sub doing the work | Read shared schedule; update **progress on their own activities**; edit their lookahead detail tasks; post/read **shared** comments only |
| Trade Partner Viewer | Sub stakeholder | Read shared schedule and shared comments only |

### 4.3 Capability matrix (capabilities × roles)

| Capability | OrgAdmin | ProjAdmin | Scheduler | PM | Super | Int.Viewer | TP Editor | TP Viewer |
|---|---|---|---|---|---|---|---|---|
| View schedule (full) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | shared-scope | shared-scope |
| Edit logic/durations/constraints | ✅ | ✅ | ✅ | ✅ | limited | — | — | — |
| Update progress / actuals | ✅ | ✅ | ✅ | ✅ | ✅ | — | own activities | — |
| Manage dependencies | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| Create/manage baselines | ✅ | ✅ | ✅ | — | — | — | — | — |
| Create lookaheads | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — |
| Edit lookahead detail tasks | ✅ | ✅ | ✅ | ✅ | ✅ | — | own scope | — |
| Post **internal** comment | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| Post **shared** comment | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| View internal comments | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| Enter Edit Mode | ✅ | ✅ | ✅ | ✅ | ✅ (scoped) | — | scoped | — |
| Manage members/roles | ✅ | ✅ | — | — | — | — | — | — |
| Manage calendars | ✅ | ✅ | ✅ | — | — | — | — | — |
| Soft-delete activities | ✅ | ✅ | ✅ | — | — | — | — | — |

("limited" / "scoped" = restricted to activities where the user's company is the `responsible_party`.)

### 4.4 External data-visibility model (key decision)

Two viable models for what a trade partner sees:

- **A — Whole-schedule read, own-slice edit (recommended).** External users can *read* the full master schedule (context matters in construction) but can only *edit progress* on activities where their company is the `responsible_party`, and only see/post **shared** comments. Simpler RLS, better field coordination.
- **B — Strict slice.** External users see *only* their own activities. Maximum confidentiality, but partners lose schedule context and it complicates dependency display.

*Recommendation: Model A for v1, with a per-project toggle to tighten to B later.* Either way, **internal comments are never visible to external users.**

### 4.5 RLS design (Supabase specifics)

Implement role checks as **`SECURITY DEFINER` SQL helper functions** so policies stay thin and avoid recursive RLS evaluation:

```
auth.uid()                          -- Supabase: current user id
fn current_company_type()           -- 'internal' | 'external' for current user
fn is_member(project_id)            -- boolean
fn role_on(project_id)              -- returns the user's role enum on a project
fn can(capability, project_id)      -- central capability check (maps role -> capability)
fn is_responsible(activity_id)      -- user's company == activity.responsible_party
```

Indicative policies (pseudo-SQL — finalized in Claude Code):

```sql
-- projects: visible if member
create policy proj_read on projects for select
  using ( is_member(id) );

-- activities: members read; external read allowed (Model A); edit gated by capability
create policy act_read on activities for select
  using ( is_member(project_id) );
create policy act_update on activities for update
  using ( can('edit_schedule', project_id)
          or (current_company_type() = 'external' and is_responsible(id)
              and /* only progress fields */ true) );

-- comments: internal comments hidden from external users
create policy comment_read on comments for select
  using ( is_member(project_id)
          and ( visibility = 'shared' or current_company_type() = 'internal' ) );
create policy comment_insert on comments for insert
  with check ( is_member(project_id)
               and ( visibility = 'shared'
                     or current_company_type() = 'internal' ) );

-- activity_history (change feed): same internal/shared rule as comments
-- memberships: only admins manage; users can read their own memberships
```

**Maintainability notes:** centralize the role→capability mapping in `can()` (or a `role_capabilities` table) so adding a capability doesn't mean rewriting every policy. Index `memberships(user_id, project_id)` and `activities(project_id)` so RLS checks stay fast. Restricting **column-level** edits (external users editing *only* progress fields) is best enforced in the **server action** layer (or via a dedicated RPC), since RLS is row-level not column-level — flag this in Section 7.

### 4.6 How this connects to other sections

- **Edit Mode (2.4):** only roles with an edit capability can enter Edit Mode; external editors enter a *scoped* Edit Mode limited to their responsible activities/progress.
- **Comments (2.4):** the `visibility` field + the comment RLS policy above are the entire internal/external comment mechanism.
- **API (7):** server actions perform the column-level and intent-level checks that RLS can't express.

### 4.7 Open decisions

- External visibility Model A (whole-schedule read) vs. Model B (strict slice). *Recommend A, toggle to B later.*
- Are roles fixed or should Project Admins define **custom roles**? *Recommend fixed role set for v1.*
- Should `responsible_party` be a single company or allow multiple responsible companies per activity?
- Notification policy for external users (only shared items — confirm).

---

## Section 5 — The Lookahead Module

### 5.0 Plain-language summary

The master schedule is the big picture; a **lookahead** is the *next few weeks* zoomed in for the field. You pick a window (say "next 3 weeks") and the tool pulls in the master activities that fall in that window so supers and subs can plan the detailed steps. The key magic: lookahead tasks stay **linked to the master** — if a master activity moves, the linked field tasks move with it. This mirrors Procore's Lookahead tab.

### 5.1 What a lookahead is

- A **Lookahead** belongs to a Project and has a **date window** (typically 1–6 weeks) and a `type` (e.g., rolling/weekly).
- When created, it **pulls all master activities intersecting the window**. Master activities render as light-gray parent bars; **LookaheadTasks** (detail/field steps) nest under their parent master activity — matching Procore's presentation.
- Supers/trade partners break master activities into granular field steps, assign crews, and track readiness.

### 5.2 Linking & auto-shift (the core behavior)

Two modeling options for how a LookaheadTask relates to its master Activity:

- **A — Offset-linked (recommended).** A LookaheadTask stores its dates as an **offset within / relative to** the master activity's computed dates. When the master shifts (engine recalc), the lookahead task's absolute dates recompute from the offset → it "moves with" the master automatically.
- **B — Independent-with-constraint.** The task has its own dates but is validated to stay within the master window; shifting the master flags (not auto-moves) the task.

*Recommendation: A for the linked behavior you'd expect from Procore*, with the option for "detached" tasks (field-only steps with no master parent) that don't move automatically.

### 5.3 Data model (extends Section 2)

- **Lookahead**: `id`, `project_id`, `name`, `window_start`, `window_end`, `type`, `created_by`, `created_at`, `source_mode` (see 5.5).
- **LookaheadTask**: `id`, `lookahead_id`, `master_activity_id` (nullable → detached task), `name`, `offset_from_master` or explicit `start`/`finish`, `crew`/`responsible_party`, `status`, `percent_complete`, optional **constraint flags** (see 5.4).

### 5.4 Make-ready / constraint planning (Last Planner-style — optional v2)

Construction lookaheads often track whether work is *ready* (materials, info, prerequisite work, permits). Plan a lightweight **constraint/readiness flag** on LookaheadTasks now (boolean "constraints cleared?" + notes), and defer full **Percent Plan Complete (PPC)** metrics and commitment tracking to v2. Flag as optional so it doesn't block v1.

### 5.5 Creating follow-up lookaheads

Match Procore's improvement: when rolling forward to the next window, offer a **source mode**:

- **From master only** (recommended default) — pulls fresh from the master schedule, ignoring the prior lookahead's edits.
- **Carry forward** — pulls in the previous lookahead's detail tasks and changes too.

### 5.6 Field updates flow back to master

When a super/trade partner marks progress on a lookahead task, that progress should **roll up to the linked master activity's `percent_complete`/actuals** (configurable). This keeps the master live from field input and feeds the CPM data-date logic (Section 3.8). Decision: auto-rollup vs. require internal review before it hits the master (recommend a setting; default auto for internal supers, review for external partners).

### 5.7 Compare to latest master

Provide a **"Compare to Latest Master"** view (Procore parity) showing where the lookahead diverges from the current master — surfaced visually and via the side-panel feed.

### 5.8 Engine interaction

Lookahead date computation reuses the **same CPM engine** (Section 3): offsets resolve against the master's engine-computed dates. No separate scheduling math — just windowing + offset resolution. Lookahead-only detail tasks can have their own mini-logic if needed (v2).

### 5.9 Open decisions

- Offset-linked (A) vs. independent (B) task model. *Recommend A.*
- Auto-rollup of field progress to master vs. review step (recommend setting; default per internal/external).
- Whether to include readiness/constraint tracking (PPC) in v1 or defer to v2 (recommend defer).
- Lookahead permissions for external editors — scope to their responsible tasks (ties to Section 4).

---

## Section 6 — UI & Component Breakdown

### 6.0 Plain-language summary

This section defines what the tool **looks like** and the pieces it's built from. The north star is the Procore scheduling look: a clean toolbar on top, an activity table on the left, the Gantt timeline in the center, and the comment/activity feed on the right — with buttons to flip between Gantt, list, and calendar views. Before any real code, we can build a **clickable HTML mockup** so you can see and react to the layout.

### 6.1 Screen anatomy (the layout shell)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Toolbar:  [Gantt|List|Calendar]  [Lookahead tab]   ⏲ Today  🔍± Zoom  │
│           ⛓ Critical Path  ▾Filters  ▾Baseline   ✎ EDIT MODE          │
├───────────────┬───────────────────────────────────────┬─────────────┤
│ Activity table│        Gantt timeline (bars)          │  Side panel  │
│ (WBS tree,    │   ▤▤▤───►▤▤  (drag/resize/link)      │  Feed:       │
│  columns,     │   critical = red, % shaded            │  • comments  │
│  expand/      │   milestones = ◆, inactive = ┄┄      │  • changes   │
│  collapse)    │                                       │  filters ▾   │
└───────────────┴───────────────────────────────────────┴─────────────┘
```

- **Top toolbar:** view switcher, Lookahead tab, Today, zoom +/−/fit, critical-path toggle, filters, baseline selector, and the **Edit Mode** button.
- **Left activity table:** WBS tree with expand/collapse, configurable columns (name, duration, start, finish, % complete, float, responsible party), inline editing when in Edit Mode.
- **Center timeline:** the Gantt (or calendar/list depending on view).
- **Right side panel:** the unified comment + change feed (Section 2.4), collapsible, filterable.

### 6.2 The build-vs-buy Gantt decision (biggest UI call)

| Option | Pros | Cons |
|---|---|---|
| **Library** (dhtmlx-gantt, svar-gantt, frappe-gantt, bryntum) | Fast to working product; built-in drag/resize/link, zoom, baselines | Styling to match Procore can fight the lib; licensing (bryntum/dhtmlx commercial); our CPM engine must override the lib's own scheduling |
| **Custom SVG/Canvas** | Full control of look & interactions; clean integration with our engine + optimistic recalc | Much more build effort; have to implement drag math, virtualization, accessibility |

*Recommendation:* **Start with a library to validate UX fast**, but keep the CPM engine authoritative (the library renders/edits; *our* engine computes dates). Re-evaluate custom rendering only if the library blocks the Procore-style interactions. Decide license tolerance early (some best ones are paid).

### 6.3 Visual design system

- **Bars:** task bars with rounded corners; **critical = red**, normal = brand blue/gray; **% complete** shown as lower-saturation fill or an inner progress fill; **milestones = diamonds (◆)**; **summary/WBS bars** as bracketed spans; **inactive dependencies = dashed lines** (matches Procore + Section 2 `is_active`).
- **Dependencies:** arrowed connectors; hover to highlight, double-click to deactivate (Procore parity).
- **Palette/typography:** clean, light, high-contrast — emulate Procore's neutral aesthetic, or apply internal branding. (Open decision: match Procore vs. custom brand.)
- **Negative float / problems:** distinct warning styling so infeasible schedules (Section 3.6) are obvious.

### 6.4 View switcher — Gantt ⇄ Calendar ⇄ List (confirmed requirement)

The toolbar includes a **view switcher** that flips the main work area between rendering modes **without losing context** (same project, same filters, same selected date range, same selected activity). Confirmed views:

- **Gantt view** — the timeline/bars view (default).
- **Calendar view** — a standard **monthly calendar grid** (with day/week/month sub-toggle), showing activities as chips/bars on the days they span, à la Procore's calendar view (task name, assigned crew/responsible party, start/finish).

Key design points to honor when we build Section 6 in full:

- **Same underlying data.** Both views render the *same engine-computed dates* (ES/EF → planned_start/finish). The calendar is just a different visualization — no separate data model. Toggling is purely a presentation switch.
- **State preservation.** Active filters (trade, responsible party, critical-only), the visible date window, and the selected activity persist across the toggle so flipping feels seamless.
- **Multi-day activities** render as bars spanning across days/weeks in the month grid; long activities wrap across week rows. Need an **overflow rule** for busy days (e.g., "+3 more" expander).
- **Click-through parity.** Clicking an activity in either view opens the same detail / side-panel feed (Section 2.4), so comments and Edit Mode work identically regardless of view.
- **Edit behavior in calendar view.** Decide how much editing is allowed from the calendar (e.g., drag an event to a new day) vs. read/coordinate only. *Recommendation: calendar view is primarily for viewing/coordination in v1; structural schedule edits (logic, durations) happen in the Gantt.* (Open decision.)
- A likely third toggle, **List/table view**, fits the same switcher (Gantt | List | Calendar) — matches Procore.

**Open decision:** how much editing the monthly calendar allows (view-only vs. drag-to-reschedule) in v1.

### 6.5 Interaction patterns (Procore parity)

- **Drag a bar** to move it; **drag its edge** to resize (changes duration); **drag the % handle** to set percent complete; **draw a link** from one bar to another to create a dependency.
- **Right-click** an activity → context menu (go to predecessor/successor, add dependency, set constraint, deactivate link).
- **Zoom** in/out and **zoom-to-fit**; **Today** button; **scroll-to-task** from a date cell.
- **Expand/Collapse all** for the WBS hierarchy.
- All structural edits happen **inside Edit Mode** (Section 2.4); each produces a change-feed entry.

### 6.6 Component tree (indicative)

```
<ScheduleApp>
  <Toolbar>            // view switcher, zoom, critical toggle, filters, Edit button
  <ViewSwitcher>       // Gantt | List | Calendar | (Lookahead tab)
  <SplitLayout>
    <ActivityTable>    // WBS tree, configurable columns, inline edit
    <MainView>         // <GanttChart> | <ListView> | <CalendarView>
    <SidePanelFeed>    // comments + change events, filters, Edit-session groups
  <ActivityDetailDrawer> // opens on activity click (shared across views)
```

### 6.7 Internal vs. external UI differences

Same app, permission-driven differences (Section 4): external users see a read-scoped schedule, **no internal comments**, an Edit button that's hidden/disabled unless they're a Trade Partner Editor (and then scoped to their activities), and no member/calendar/baseline admin controls.

### 6.8 State management & data flow

- Client store (e.g., Zustand/Redux) holds the loaded schedule + engine outputs.
- **Optimistic updates:** edit → local CPM recalc → instant re-render → server action → authoritative result → reconcile (Section 1/7).
- **Realtime:** subscribe to the project channel; apply inbound changes from other users (Section 7).

### 6.9 Field/responsive considerations

Superintendents work on tablets. Plan the **calendar and lookahead views to be tablet-friendly**; the full Gantt editing experience is desktop-first. (Mobile-native is out of scope for v1.)

### 6.10 Recommended next step: clickable mockup

Before Claude Code implementation, build a **static HTML/Tailwind mockup** of the layout (toolbar + table + Gantt + side panel + view switcher) so you can validate the Procore-style look and interactions cheaply. No backend — just the visual shell.

### 6.11 Open decisions

- Build-vs-buy Gantt (recommend library first; confirm license tolerance).
- Match Procore aesthetic vs. internal branding.
- Calendar view editing: view-only vs. drag-to-reschedule (from 6.4).
- Client state library choice (Zustand vs. Redux Toolkit).

---

## Section 7 — API Design & Real-Time Collaboration

### 7.0 Plain-language summary

This is how the screens talk to the database. Two paths: **reads** can go straight from the browser to Supabase (RLS keeps them safe), while **changes** to the schedule go through a server function that runs the CPM engine, saves the result in one transaction, and then pushes the update to everyone else viewing the project — so two people editing at once stay in sync.

### 7.1 API style (fits the stack)

- **Reads:** client → Supabase directly (PostgREST/Realtime), protected by RLS. Fast, less code.
- **Writes that affect the schedule:** go through a **Next.js server action / route handler** that (a) re-checks permission incl. column-level rules RLS can't express (Section 4.5), (b) runs the CPM engine, (c) writes results transactionally, (d) relies on Realtime to fan out.
- **Simple writes** (e.g., posting a comment) can go client→Supabase under RLS, no engine needed.

### 7.2 Intent / command model

Schedule mutations are expressed as **intents**, not raw row writes, so the engine and audit log stay authoritative:

```
applyScheduleEdit({
  projectId, editSessionId,
  ops: [ {type:'moveActivity', id, newStart},
         {type:'setDuration', id, days},
         {type:'addDependency', pred, succ, relType, lag},
         {type:'deactivateDependency', id},
         {type:'setProgress', id, percent, actualStart?} ] })
→ validates → engine.calculate() → tx write (activities + activity_history) → returns authoritative result
```

Each op writes an `ActivityHistory` row tagged with `editSessionId` (Section 2.4).

### 7.3 Endpoint / action catalog (indicative)

- `projects`: list/create/update/archive (admin).
- `activities`: create / softDelete / `applyScheduleEdit` (the main mutation).
- `dependencies`: create / deactivate / delete (via intents).
- `recalculate(projectId)`: force full engine recalc.
- `baselines`: create / list / compare.
- `lookaheads`: create (with `source_mode`) / addTask / updateTask / compareToMaster.
- `comments`: create / edit / softDelete (RLS-guarded; visibility honored).
- `members`: invite / setRole / remove (admin only).
- `calendars`: CRUD (Scheduler/Admin).

### 7.4 Transactions

Engine recalc + row writes happen in **one Postgres transaction** (via a Supabase RPC / `supabase.rpc` or a transactional server action) so a schedule never persists half-recalculated. On failure, roll back and return the problem list (cycles, constraint conflicts).

### 7.5 Real-time collaboration

- **Supabase Realtime** channel per project; clients subscribe on load.
- When the authoritative write lands, changed rows broadcast to all subscribers; each client **reconciles** its optimistic prediction with the truth.
- **Presence:** show who's online and who's currently in Edit Mode (reduces collisions, Procore-style multi-user awareness).

### 7.6 Conflict resolution

- **Optimistic concurrency:** each activity carries a `version`/`updated_at`; an intent includes the version it was based on. If the server detects the row changed underneath, it **re-runs the engine on current state** and returns the reconciled result (server-authoritative — Section 1).
- **Soft edit-locks (optional):** when a user enters Edit Mode on a sub-tree, optionally signal it via presence so others see "Tanner is editing." Advisory, not hard locks, for v1.
- **No silent overwrites:** because the engine recomputes from the canonical state on every write, concurrent edits converge rather than clobber.

### 7.7 Validation, errors, security

- Server actions enforce **column-level** rules (e.g., external editor may set progress only) — the gap RLS leaves (Section 4.5).
- Engine **problems** (cycles, constraint conflicts, negative float) returned in a structured `problems[]` for the UI to surface.
- All mutations re-checked server-side even though RLS also guards — defense in depth.

### 7.8 Open decisions

- Direct client→Supabase reads vs. routing everything through server actions (recommend hybrid as above).
- Presence/soft-lock in v1 or v2 (recommend lightweight presence in v1, locks later).
- Versioning field strategy (`updated_at` vs. integer `version`).

---

## Section 8 — Phased Build Roadmap

> The order to build in Claude Code. Each phase lists its goal, what it depends on, and a "done when" check. **MVP cut line noted at Phase 9.**

**Phase 0 — Project setup.** Next.js + TypeScript repo on GitHub; Supabase project; Cloudflare Workers deploy from main (via @opennextjs/cloudflare); Supabase Auth scaffolding (internal login first). *Done when:* a deployed "hello" app authenticates a user.

**Phase 1 — CPM engine in isolation (do this first).** Build the pure `schedule-engine/` module (Section 3) with full test suite, **no UI/DB**. **Day-based granularity (confirmed)** — build the calendar helpers around a generic "working-unit" so hour-based can be added later. *Done when:* golden-master + property tests pass for all four relationship types, lags, constraints, calendars, and progress/data-date.

**Phase 2 — Data model & migrations.** Postgres tables for all Section 2 entities; helper SQL functions + skeleton RLS (Section 4.5). *Done when:* migrations apply cleanly; basic RLS proven with two test users (internal/external).

**Phase 3 — Schedule CRUD + engine wiring (server).** `applyScheduleEdit` intent path; transactional recalc; read APIs. *Done when:* creating activities/dependencies via API produces correct engine-computed dates persisted to DB.

**Phase 4 — Gantt rendering (read-only).** Decide build-vs-buy (Section 6.2); render the schedule from engine output; activity table + WBS tree + toolbar shell. *Done when:* a real schedule displays correctly with critical path + baseline-less bars.

**Phase 5 — Interactive editing + Edit Mode.** Drag/resize/link, inline edits, optimistic local recalc, Edit sessions writing `ActivityHistory`. *Done when:* dragging a bar shifts dependents instantly and persists authoritatively, with change events logged.

**Phase 6 — Real-time collaboration.** Supabase Realtime channels, reconciliation, presence (Section 7.5–7.6). *Done when:* two browsers editing the same project stay in sync without clobbering.

**Phase 7 — Comments side panel + visibility.** Unified feed (comments + change events), internal/shared visibility with RLS (Section 2.4 / 4.5). *Done when:* an external test user cannot see internal comments at the DB level.

**Phase 8 — Calendar & List views (view switcher).** Gantt | List | Calendar toggle with state preservation (Section 6.4). *Done when:* flipping views keeps filters/selection and renders the same data.

**Phase 9 — Lookahead module.** Windowing, master-linked offset tasks, follow-up source modes, field progress rollup (Section 5). *Done when:* moving a master activity shifts its linked lookahead tasks. **← End of MVP.**

**Phase 10 — Baselines & variance.** Snapshot + compare-to-master (Sections 2 / 5.7). *Done when:* planned-vs-actual variance is visible.

**Phase 11 — Permissions hardening.** Full external Trade Partner roles, scoped Edit Mode, column-level checks, audit review (Section 4). *Done when:* the full capability matrix is enforced and tested.

**Phase 12 — Import/sync (optional/later).** MPP/XER import (Section 0). *Done when:* a sample P6/MSP file imports into the model.

**Then → Procurement Management planning pass** (separate spec) hooking into this foundation: ties procurement items to activities/resources, lead-time-driven scheduling constraints, and budget linkage (the reason we flagged cost fields in Section 2.5).

### 8.1 Recommended first three moves in Claude Code

1. Point Claude Code at this `SCHEDULING-TOOL-PLAN.md`.
2. Build **Phase 1 (the CPM engine) in isolation with tests** before any UI/DB — it's the correctness-critical core.
3. Granularity is **day-based** (decided) — build the calendar helpers around a generic working-unit so hour-based can be added later without a rewrite.

