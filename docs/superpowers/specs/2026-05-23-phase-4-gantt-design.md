# Phase 4 — Section 6 UI in Next.js (Design Spec)

> **Status:** Draft, pending user review.
> **Scope:** Section 6 (UI & Component Breakdown) of `docs/SCHEDULING-TOOL-PLAN.md`, built in the project's Next.js 16 app. Supersedes the single-file `index.html` prototype.
> **Date:** 2026-05-23
> **Branch:** `docs/phase-4-design` (spec lands here; implementation will follow on a `feat/phase-4-ui` branch).

---

## 1. Scope & Decisions

This phase **collapses Phases 4, 5, 7, and 8** of the original Section 8 roadmap into a single Next.js build that mirrors the UX validated in `index.html`. The original Phase 4 cut (read-only Gantt only) is widened because the visual + interaction model is already validated and a partial v1 has limited demo value.

### In scope

- Next.js 16 (App Router) build of the full Section 6 UI.
- `@supabase/ssr` cookie-based auth with middleware refresh; a real `/login` page.
- Server-component bootstrap read of the schedule on first paint.
- Direct `@supabase/supabase-js` for all subsequent reads and writes (no use of Phase 3 server routes).
- Canonical TS CPM engine in `src/lib/schedule-engine/` imported directly into the client; client-side recalc on every change.
- TanStack Query owns server state; Zustand owns UI state.
- Custom React Gantt — port of the SVG/HTML rendering from `index.html`. Raw Tailwind, no component library.
- All four views functional: **Gantt, List, Calendar, Lookahead**.
- View switcher preserves `selectedActivityId`, `filters`, `zoom`, visible date window.
- Activity table with WBS tree, expand/collapse, configurable columns, inline edit.
- Side panel feed: comments + `activity_history`, filterable, with comment composer.
- Edit Mode toggle (banner): drag-move bar, drag-resize edge, draw dependency arrow, inline edit of name/duration, deactivate / delete link, delete activity.
- Optimistic-concurrency writes via integer `version` column with one retry on conflict.
- `activity_history` rows written on every mutation, tagged with `edit_session_id` and engine-cascade rows tagged `source = 'engine_cascade'`.
- Critical-path toggle, today line, filter chips, problems badge.
- Single project: hardcoded to the seeded Riverside Office Build (`70000000-0000-0000-0000-000000000000`).
- The retired `index.html` is deleted as part of the implementation plan (Task 1 of that plan).

### Out of scope (later phases of the master plan)

- Realtime multi-user sync (Phase 6 of the master plan).
- Soft-locks / presence (Phase 6).
- Baseline diff overlay (Phase 10).
- Attachment upload.
- External-user UI variants beyond hiding the Edit button (Phase 11). Login works for any seeded user; role-aware UI gating beyond the Edit button is deferred.
- Tablet / responsive layout work.
- WBS rollup correctness beyond simple `min(start)` / `max(finish)`.
- Resource leveling, resource histograms.
- MPP / XER import (Phase 12).
- Project switcher.
- Activity types beyond `task` and `milestone`.
- Calendar-view editing (drag-to-reschedule from the month grid). View-only in v1.
- Calendar config editing (working weekdays, exceptions) and WBS structural editing (reparent, rename, add/delete nodes).
- Use of the Phase 3 server pipeline (`POST /api/schedule/apply`, `GET /api/projects/:id/schedule`, `/api/calendars`, `/api/wbs-nodes`). The routes and `apply_schedule_edit` RPC remain on disk and in the database as dormant code; they may be revived in Phase 6 if realtime needs server-side reconciliation.

### Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| App shell | Next.js 16 App Router | Sticks to the master plan stack. |
| Data layer | Direct `@supabase/supabase-js` everywhere | Simplest plumbing; RLS still enforces permissions; engine in TS becomes a normal import (zero drift). |
| Auth | `@supabase/ssr` + middleware + `/login` page | Cookie sessions shared across server and client; SSR-bootstrap on first paint; canonical Next.js 16 pattern. |
| Server state | TanStack Query | Cache, invalidation, optimistic mutations, retry-on-conflict. |
| UI state | Zustand | `selectedActivityId`, `view`, `zoom`, `filters`, `mode`, `editSessionId`. |
| Gantt rendering | Custom React component tree | Visual model already validated; no library to fight or license. |
| Styling | Raw Tailwind, no component library | Project already has Tailwind; primitives stay in-repo, fully owned. |
| Engine | Canonical TS engine in `src/lib/schedule-engine/`, imported directly | Single source of truth; no vanilla-JS port; no parity layer. |
| Concurrency | Integer `version` column + one retry on conflict | Same model as Phase 3 RPC; cheap correctness. |
| Project scope | Hardcoded project ID for v1 | Matches `index.html`; picker deferred. |
| Calendar editing | View-only in v1 | Section 6.4 recommendation; reduces edit-mode surface area. |
| Aesthetic | Neutral palette validated in `index.html` | Procore-adjacent; branding pass later. |

---

## 2. Architecture

### High-level flow

```
                ┌────────────────────────────────────────────────────────┐
                │ Next.js 16 App Router                                  │
                │                                                        │
   browser ───► │  middleware.ts            (@supabase/ssr refresh)      │
                │  /login/page.tsx          (form → signInWithPassword)  │
                │  /projects/[id]/page.tsx  (server component)           │
                │     • SSR client fetches bootstrap in parallel         │
                │     • passes JSON prop to <ScheduleApp/>               │
                │                                                        │
                │  <ScheduleApp/>           (client; TanStack + Zustand) │
                │     • hydrates query cache with bootstrap              │
                │     • mounts shell: <Toolbar> <ActivityTable> <View>   │
                │       <SidePanel> <EditModeBanner> <ProblemsBadge>     │
                │     • runs CPM engine selector on every state change  │
                └─────────────┬──────────────────────────────────────────┘
                              │ HTTPS (browser supabase-js)
                              ▼
                ┌──────────────────────────────────────┐
                │ Supabase                              │
                │   PostgREST + Auth                    │
                │   RLS policies enforce permissions    │
                └──────────────────────────────────────┘
```

### Why this shape

- **Server-component bootstrap** lets the cold-load paint a real Gantt instead of a loading shell.
- **TanStack Query for server state** gives us optimistic mutations + rollback + retry-on-conflict for free.
- **Zustand for UI state** keeps view/zoom/selection/filter state out of TanStack Query (where it doesn't belong) and out of prop-drilling.
- **Engine as a TS import** eliminates the vanilla-JS port that `index.html` carried. There is exactly one engine; drift is impossible.
- **Direct supabase-js for writes** trades server-side reconciliation (the Phase 3 pipeline) for simplicity. The pipeline can be revived later if Phase 6 realtime requires it.

---

## 3. Component tree & file layout

```
src/app/
  layout.tsx                  Root layout + TanStack Query / Zustand providers
  middleware.ts               @supabase/ssr session refresh
  login/page.tsx              Supabase email/password login form
  projects/[id]/page.tsx      Server component: auth-gates, fetches bootstrap data
                              with the SSR client, hands JSON to <ScheduleApp>

src/components/schedule/
  ScheduleApp.tsx             Top-level client; hydrates bootstrap into TanStack
                              Query cache, wires keyboard shortcuts, mounts shell
  Toolbar.tsx                 View switcher, Today, zoom ±, critical-path toggle,
                              filter chips, Edit Mode button, user chip
  ActivityTable/
    ActivityTable.tsx         Left pane container, WBS tree, columns
    WbsRow.tsx                One row (summary bar or activity)
  Gantt/
    GanttChart.tsx            Main timeline; computes layout from engine output
    GanttHeader.tsx           Date axis (day / week / month based on zoom)
    GanttGrid.tsx             Day/week stripes background
    GanttBar.tsx              Single bar (task / milestone / group)
    GanttDependency.tsx       SVG arrow connector
    GanttDragLayer.tsx        Edit-mode pointer handlers (move / resize / draw-dep)
  List/ListView.tsx           Flat sortable table view
  Calendar/CalendarView.tsx   Monthly grid (view-only in v1)
  Lookahead/LookaheadView.tsx Lookahead view
  SidePanel/
    SidePanel.tsx             Comments + history feed, filter chips
    CommentComposer.tsx       Input + internal/shared visibility
  EditModeBanner.tsx          Pill + Save / Discard
  ProblemsBadge.tsx           Engine problems indicator

src/lib/
  schedule-engine/            Existing — imported as a TS module from the client
  supabase/
    client.ts                 createBrowserClient
    server.ts                 createServerClient (cookies-aware)
  state/
    queries.ts                useSchedule, useComments, useHistory (TanStack Query)
    mutations.ts              useSaveActivity, useSaveDependency, useInsertDependency,
                              useDeleteActivity, usePostComment, useLogHistory
    ui-store.ts               Zustand: selectedId, view, zoom, filters, mode, editSessionId
    recalc.ts                 buildEngineInput / runRecalc / mergeResults

src/app/api/                  Phase 3 routes remain on disk but are NOT called by the UI
index.html                    Deleted in Task 1 of the implementation plan
```

---

## 4. Data flow

### 4.1 Bootstrap (initial load)

`projects/[id]/page.tsx` is a server component. It uses the `@supabase/ssr` server client to fetch in parallel: `project`, `calendars`, `calendar_exceptions`, `wbs_nodes`, `activities`, `dependencies`, `activity_constraints`, `comments`, `activity_history`, `lookaheads`, `lookahead_tasks`. The bootstrap object is passed as a prop to `<ScheduleApp>`. On mount, `ScheduleApp` calls `queryClient.setQueryData(['schedule', projectId], bootstrap)` so TanStack Query treats the data as already-fetched. First paint shows the Gantt; no client-side loading state on the cold load.

If the SSR client has no session, the page redirects to `/login?next=/projects/[id]`.

### 4.2 Recalc loop

After every change to the cached schedule (activities, dependencies, constraints, calendars), a memoized selector `useScheduleResult` builds the engine input and calls `calculate()` from `src/lib/schedule-engine/index.ts`. Renderers read engine-computed fields (`plannedStart`, `plannedFinish`, `isCritical`, `totalFloat`, `freeFloat`, problems) from the memoized result — never directly from the engine. Engine runs synchronously in the render path; for our scale (≤ a few hundred activities) it stays well under one frame. If profiling shows otherwise we move it into `useDeferredValue` or a worker; not a v1 concern.

### 4.3 Write loop (engine-touching edits)

Every engine-touching mutation hook (e.g. `useSaveActivity`, `useSaveDependency`, `useInsertDependency`, `useDeleteActivity`) follows the same pattern:

1. **Optimistic update** — `onMutate` patches the TanStack Query cache with the new field values. The recalc selector re-runs and the Gantt redraws instantly.
2. **DB write** — `supabase.from(<table>).update({...fields, version: current + 1}).eq('id', id).eq('version', current).select().single()`.
3. **History rows** — one `activity_history` insert per changed field, tagged with the current `editSessionId`. Engine-cascaded activities (those the engine shifted as a side effect of the user's primary edit) get their own rows tagged `source = 'engine_cascade'` so the side panel can distinguish them from direct intent.
4. **Conflict path** — `update().select().single()` returning `null` row ⇒ refetch the row, re-apply the edit on top, retry the update once. Second failure ⇒ `onError` rolls back the cache patch and surfaces a toast.

### 4.4 Non-engine writes

The only non-engine write in scope for Phase 4 is **posting a comment**. Comments insert against `comments` with `scope` and `visibility` set from the composer. They do not bump any other row's `version`, do not trigger recalc, and do not write `activity_history` rows. They follow the same optimistic-patch + rollback-on-error pattern as engine writes, minus the cascade and history steps.

Calendar editing and WBS structural editing (reparent, rename nodes) are out of scope (see §1) — when they land later they will be engine-touching writes (calendar changes recompute dates; reparenting does not but still version-checks).

### 4.5 Edit Mode

Entering Edit Mode:
1. Generate `editSessionId = crypto.randomUUID()` and store on the Zustand UI store.
2. Add `edit-mode` class to `<body>` (gates drag handles, dependency-draw handles, contenteditable cells via CSS).
3. Render the `<EditModeBanner>`.

Banner buttons:
- **Save** — clears the flag. Persistence already happened on each pointer-up; nothing to flush.
- **Discard** — reverts local optimistic state only. Does **not** undo DB writes. Banner copy reads "Discard local-only edits — already-saved changes stay." Real undo is later work.

### 4.6 Realtime (out of scope)

Phase 4 has no realtime subscription. Two simultaneous editors hit the version-conflict path; one wins, the other gets the toast and rolls back. Acceptable for a single-team v1. Phase 6 of the master plan adds Supabase Realtime + reconciliation.

---

## 5. Error handling

| Failure | Surface | Behavior |
|---|---|---|
| Engine problems (cycle, invalid input, constraint violation, open-end) | Toolbar `ProblemsBadge` + red outline on affected bars + clickable list in side panel | Schedule still renders with last-good dates. Cycles trigger a banner because `projectFinish` is `null`. |
| User-introduced cycle while drawing a dependency | Inline preview during drag turns red; drop is blocked | Local-only; never reaches Supabase. |
| `update` returns 0 rows (version conflict) | First failure: silent refetch + retry. Second failure: toast "This activity was changed by someone else — your edit was discarded" + cache rollback. | |
| `select` / `update` network or RLS error | Toast with error message + cache rollback | RLS denial is treated like any other write failure. |
| Session expired mid-session | Middleware redirects next request to `/login` | TanStack Query naturally retries on focus; the redirect happens on the next server-touching action. |
| Engine returns `null` `projectFinish` | Full-width yellow banner above the Gantt: "Schedule is unsolvable — see Problems" | Don't block editing; let the user fix the cycle. |

---

## 6. Testing

### Vitest unit tests

- `recalc.ts` selector wiring: given a fixed cache snapshot, asserts engine output matches a golden record.
- The cascade-diff that produces history rows: given a primary edit and an engine result, assert the expected `(entity_id, field, old, new, source)` set.
- Optimistic-patch helpers: cache-update → recalc → rollback path.
- Version-conflict retry: mocked supabase client returning 0 rows then 1 row, assert exactly one retry, no toast.
- Version-conflict double failure: mocked supabase returning 0 rows twice, assert cache rollback and toast.

### React Testing Library component tests

- `Toolbar` toggles (view, critical-path, edit) update Zustand state.
- `WbsRow` expand/collapse hides/shows children.
- `GanttBar` layout: given an `ActivityResult`, assert pixel offsets and width.
- `GanttDependency` SVG path between two known bars.
- `CalendarView` chip placement on the right day for a multi-day activity.

### Playwright E2E

One happy-path spec against the hosted Supabase project:
1. Log in as `scheduler@ihs.test` / `password123`.
2. Riverside Office Build loads on first paint.
3. Toggle critical path — Mobilize and Pour Foundations highlight red.
4. Enter Edit Mode, drag Mobilize +2 days, release.
5. Pour Foundations shifts +2 days (engine cascade).
6. Reload — both shifts persisted.
7. Open the side panel — two `activity_history` rows present, one tagged `engine_cascade`.

One external-user spec:
1. Log in as `tp-viewer@trade.test`.
2. Edit button is hidden.
3. Internal comments are not visible.

### Engine tests

Already covered by the golden + property tests in `src/lib/schedule-engine/`. We import the engine directly, so no parity layer is needed.

### Phase 3 routes

Not tested in Phase 4 because Phase 4 does not call them. The existing integration tests for the Phase 3 pipeline continue to run untouched.

---

## 7. Success criteria — Phase 4 Done When

1. Logging in shows the Riverside Office Build at first paint, no client-side loading flicker.
2. All four views (Gantt / List / Calendar / Lookahead) render real Supabase data.
3. View switcher preserves `selectedActivityId`, `filters`, `zoom`, and the visible date window.
4. Critical-path toggle highlights critical bars red.
5. In Edit Mode: drag-move, drag-resize, draw-dependency, inline-edit name/duration, deactivate link, delete activity — each persists with version check, writes `activity_history` rows, and cascades engine-computed dates to dependents.
6. Posting a comment with `internal` visibility hides it from `tp-viewer@trade.test`.
7. Two browsers editing the same activity simultaneously: one succeeds, the other gets the version-conflict toast and rolls back (no data corruption).
8. `npm run lint`, `npm run typecheck`, `npm test`, and `npm run test:e2e` all pass.
9. `index.html` is deleted from the repo.

---

## 8. Open questions / accepted risks

- **Phase 3 server pipeline is dormant.** All Phase 3 work (`apply_schedule_edit` RPC, intent route handlers, integration tests) stays on disk but is not exercised by the UI. Risk: it bit-rots. Mitigation: existing Phase 3 integration tests run in CI and catch breakage. If Phase 6 revives the pipeline for realtime reconciliation, it remains buildable.
- **Engine runs on the client.** Untrusted clients can post fabricated dates that contradict engine output. RLS does not validate "is this date what the engine would have computed." For an internal-team v1 this is acceptable; Phase 11 (permissions hardening) re-introduces server-side recompute via the dormant pipeline if needed.
- **Edit Mode "Discard" does not roll back DB writes.** Documented in UI copy. A real undo log is later work.
- **No realtime.** Concurrent edits resolve via version conflicts. Acceptable for v1; Phase 6 fixes it.
- **No project switcher.** Hardcoded to Riverside Office Build.
- **Login is open** to anyone with a valid Supabase user. Production would add SSO + email-domain allowlists.
- **WBS rollup approximation.** Simple `min(start)` / `max(finish)` from children. Weighted % complete deferred.
- **Calendar view is view-only in v1.** Drag-to-reschedule from the month grid is deferred.
