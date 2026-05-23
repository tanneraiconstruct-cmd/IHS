# Section 6 UI Build-Out in `index.html` — Design Spec

> **Status:** Approved. Implementation follows directly in `index.html`.
> **Scope:** Section 6 (UI & Component Breakdown) of `docs/SCHEDULING-TOOL-PLAN.md`,
> built as a working single-file SPA wired directly to the hosted Supabase
> project (`uluasgpcokjwowpawavl`).
> **Date:** 2026-05-22
> **Branch:** `feat/schedule-crud` (the spec lands here; the build extends `index.html`).

---

## 1. Scope & Decisions

**In scope:**

- Make the existing static mockup in `index.html` functional end-to-end.
- Browser → Supabase reads/writes, via `@supabase/supabase-js` from a CDN ES module.
- Embedded email/password login overlay; session persisted by Supabase Auth.
- Vanilla-JS port of the CPM engine (forward + backward + float + cycle detection),
  mirroring `src/lib/schedule-engine/` for the cases the UI exercises.
- All four views functional from real data: Gantt, List, Calendar, Lookahead.
- View switcher preserves selection, filters, date window.
- Activity table: WBS tree with expand/collapse, selection drives all views.
- Side panel feed: comments + activity_history, filterable, with comment composer.
- Edit Mode toggle: drag-move bars, drag-resize, draw dependency arrows,
  inline edit of name/duration, deactivate / delete link, delete activity.
- Optimistic-concurrency writes via `version` column with one retry on conflict.
- `activity_history` rows written on every mutation, tagged with `edit_session_id`.
- Critical-path toggle, today line, filter chips.
- Single file — all CSS and JS live in `index.html`. The only external load is
  `@supabase/supabase-js` from `https://esm.sh/@supabase/supabase-js@2`.

**Out of scope (later phases of the master plan):**

- Realtime multi-user sync (Phase 6).
- Soft-locks / presence (Phase 6).
- Baseline diff overlay (Phase 10).
- Attachment upload (later).
- External-user UI variants (Phase 11) — login works for any seeded user,
  but role-specific UI gating beyond hiding the Edit button is deferred.
- Tablet / responsive layout work.
- WBS rollup correctness beyond simple min-start / max-finish.
- Resource leveling, resource histograms.
- MPP / XER import (Phase 12).
- Project switcher; project ID is hardcoded to the seeded
  `Riverside Office Build` (`70000000-0000-0000-0000-000000000000`).
- Activity types beyond `task` and `milestone` (no `summary`,
  no `level_of_effort`).

**Locked decisions:**

| Decision | Choice | Rationale |
|---|---|---|
| Data layer | Browser → Supabase directly | Matches user's single-file preference; RLS still enforces permissions. |
| Engine in browser | Hand-port to vanilla JS inline | Keeps `index.html` self-contained. Drift risk vs `src/lib` is acceptable for this UI demo. |
| Auth | Embedded login form, Supabase Auth | Real session, RLS-scoped reads, demonstrable role behavior. |
| Scope | Full Section 6 + drag-to-edit | User wants the full build-out; UX feel only emerges with editing live. |
| Concurrency | Integer `version` column, one retry on conflict | Matches Phase 3 spec; cheap correctness. |
| State management | Tiny inline pub/sub store | No framework. ~30 LoC. |
| Reactivity model | Per-view subscribers re-render their slice | Easier to reason about than VDOM diffing for a single page. |

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ index.html                                                   │
│                                                              │
│  HTML SHELL  (toolbar · table · gantt · side panel · banner) │
│  LOGIN OVERLAY (shown until session resolves)                │
│  <style> (existing + new edit-affordance classes)            │
│  <script type="module">                                      │
│    1. CONFIG       — Supabase URL + anon key, project_id     │
│    2. SUPABASE     — createClient, session bootstrap         │
│    3. ENGINE       — forward, backward, float, cycles        │
│    4. STATE        — pub/sub store + selectors               │
│    5. DATA         — load(), save*(), post*(), log*()        │
│    6. RECALC       — buildEngineInput → engine → merge       │
│    7. RENDER       — toolbar, table, gantt, list, calendar,  │
│                       lookahead, sidePanel, banner, problems │
│    8. EDIT         — drag-move, drag-resize, draw-dep,       │
│                       inline-edit, delete, deactivate        │
│    9. AUTH         — loginUi, signIn, signOut                │
│   10. BOOT         — session → load → recalc → render        │
│  </script>                                                   │
└──────────────────────────────────────────────────────────────┘
            │ HTTPS
            ▼
   ┌──────────────────────────┐
   │ Supabase (PostgREST/Auth)│
   │  RLS policies enforce     │
   │  per-user data access     │
   └──────────────────────────┘
```

Single round trip on boot: parallel SELECTs against
`projects`, `calendars`, `calendar_exceptions`, `wbs_nodes`, `activities`,
`dependencies`, `activity_constraints`, `comments`, `activity_history`,
`lookaheads`, `lookahead_tasks`.

---

## 3. Module-by-module spec

### 3.1 CONFIG

```js
const SUPABASE_URL  = 'https://uluasgpcokjwowpawavl.supabase.co';
const SUPABASE_ANON = '<anon key — safe in browser>';
const PROJECT_ID    = '70000000-0000-0000-0000-000000000000';
```

Hardcoded constants in source. The anon key is public; the project ID is the
seeded Riverside Office Build.

### 3.2 SUPABASE

```js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true },
});
```

### 3.3 ENGINE (vanilla-JS port)

Mirror of `src/lib/schedule-engine/` but in plain JS. Functions:

- `addWorkdays(calendar, isoDate, n)` — n may be negative.
- `diffWorkdays(calendar, a, b)` — for lag math.
- `isWorking(calendar, isoDate)` — weekday + exception.
- `forwardPass(input, graph, topo) → { earlyDates, projectFinish, violations }`
- `backwardPass(input, graph, topo, projectFinish) → { lateDates, violations }`
- `computeFloat(input, graph, early, late, threshold) → Map<id, {totalFloat, freeFloat, isCritical}>`
- `buildGraph(activities, dependencies)`
- `detectCycles(activities, graph) → string[][]`
- `topologicalSort(activities, graph)`
- `calculate(input) → { activities[], projectFinish, problems[] }`

Inputs accepted: `task`, `milestone` activity types; FS/SS/FF/SF deps with lag;
SNET/SNLT/FNET/FNLT/MSO/MFO/ALAP constraints. `summary` and `level_of_effort`
inputs are dropped before engine input is built; their dates are derived
from children via the lightweight rollup.

WBS rollup: simple `min(child.plannedStart)` and `max(child.plannedFinish)`
per node, displayed only — not stored back to DB.

### 3.4 STATE

```js
const state = {
  session: null,
  project: null,
  calendars: [],
  wbsNodes: [],
  activities: [],     // input + computed result merged
  dependencies: [],
  constraints: [],
  comments: [],
  history: [],
  lookaheads: [],
  lookaheadTasks: [],
  view: 'gantt',      // 'gantt' | 'list' | 'calendar' | 'lookahead'
  selectedId: null,   // activity id
  filters: { critical: false, trade: null, responsibleCompany: null },
  mode: 'view',       // 'view' | 'edit'
  editSessionId: null,
  problems: [],
  zoom: 'week',       // 'day' | 'week' | 'month'
};

const subs = new Map();
function on(keys, fn) { /* subscribe + immediate fire */ }
function set(key, val) { state[key] = val; fire(key); }
function patch(key, partial) { state[key] = { ...state[key], ...partial }; fire(key); }
```

### 3.5 DATA

```js
async function load(projectId) { /* parallel SELECTs into state */ }
async function saveActivity(id, patch) { /* update with version check */ }
async function saveDependency(id, patch) { /* same */ }
async function insertDependency(row) { /* insert + return id */ }
async function deleteActivity(id) { /* soft-delete via deleted_at */ }
async function postComment({ body, scope, target, visibility }) { /* insert */ }
async function logHistory({ entity, entityId, field, oldVal, newVal }) { /* insert */ }
```

Concurrency pattern (per row):
1. SELECT `version` is held in `state.activities[i].version`.
2. UPDATE with `eq('id', id).eq('version', currentVersion).select()`.
3. If no rows returned → refetch the row, re-apply edit, retry once.
4. On second failure → toast + revert local change.

Every successful save also fires `logHistory` for the changed field(s).

### 3.6 RECALC

```js
function buildEngineInput() {
  return {
    projectStart: state.project.project_start,
    dataDate: state.project.data_date,
    defaultCalendarId: state.project.default_calendar_id,
    calendars: state.calendars.map(toEngineCalendar),
    activities: state.activities
      .filter(a => !a.deleted_at && (a.activity_type === 'task' || a.activity_type === 'milestone'))
      .map(toEngineActivity),
    dependencies: state.dependencies
      .filter(d => !d.deleted_at)
      .map(toEngineDependency),
  };
}

function recalc() {
  const result = engine.calculate(buildEngineInput());
  for (const r of result.activities) mergeIntoActivity(r);
  set('problems', result.problems);
  set('activities', state.activities);
}
```

Recalc runs after every successful edit and after initial load.

### 3.7 RENDER

Subscribers (key → render fn):

| Subscribes to | Renderer |
|---|---|
| `view` | `renderViewSwitcher`, `renderMainView` (delegates to view-specific) |
| `activities`, `dependencies`, `zoom`, `filters` | `renderGantt`, `renderList`, `renderCalendar` |
| `lookaheads`, `lookaheadTasks`, `activities` | `renderLookahead` |
| `selectedId`, `activities` | `renderTable`, `renderGanttSelection`, `renderSidePanel` |
| `mode` | `renderBanner`, `applyEditClass` |
| `comments`, `history`, `selectedId` | `renderSidePanel` |
| `problems` | `renderProblems` |
| `filters` | `renderFilterChips` |
| `session` | `renderLoginOverlay`, `renderUserChip` |

Re-render strategy: each renderer **rebuilds its DOM subtree** from current
state. Datasets are small (≤ 100s of activities) so a full rebuild per change
is fine; no diffing.

### 3.8 EDIT

Active only when `state.mode === 'edit'`. Entering Edit Mode:
1. Generate `editSessionId = crypto.randomUUID()`.
2. Add `edit-mode` class to `<body>`.
3. Show banner.
4. Banner "Save edits" simply ends session (changes are already persisted on
   pointer-up); "Discard" is best-effort revert via local state only and
   shows a warning that DB writes are not rolled back. v1 documents this.

Interactions:
- **Drag-move bar:** mousedown on bar → capture pointer → on move, compute
  delta in days (`Math.round(dx / dayW)`) → update local `planned_start` and
  `planned_finish`, recalc, re-render. On mouseup: persist
  `planned_start`/`planned_finish` for the dragged activity (the cascade is
  recomputed server-side at next recalc; we also persist cascaded values).
- **Drag-resize edge:** same but only updates `original_duration` / `remaining_duration`.
- **Draw dependency:** in edit mode, hovering near a bar's right edge shows
  a handle; mousedown on the handle starts drawing an SVG line that follows
  the cursor; mouseup on another bar inserts a `dependencies` row
  (`type='FS', lag=0`).
- **Inline edit name/duration:** double-click table cell → contenteditable →
  blur saves.
- **Right-click context menu:** small menu with Delete activity / Add
  dependency / Deactivate link.

History writes:
- On each persisted change, insert one `activity_history` row per changed
  field, tagged `(edit_session_id, entity_type, entity_id, field, old, new)`.
- Engine-cascade changes use the same `edit_session_id` but
  `session_note = 'engine_cascade'` to distinguish from the user intent
  in the feed.

### 3.9 AUTH

Login overlay (centered card):
- Email input, password input, Sign-in button, error line.
- On submit: `sb.auth.signInWithPassword({email, password})`.
- On success: hide overlay, run BOOT.
- Logout button replaces the "IHS" tile area's right side in the top toolbar.

Session watcher (`sb.auth.onAuthStateChange`) re-renders the overlay if
the session disappears.

### 3.10 BOOT

```js
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  set('session', session);
  if (!session) return; // overlay stays
  await load(PROJECT_ID);
  recalc();
  wireToolbar();
  wireViewSwitcher();
  wireEditMode();
}
sb.auth.onAuthStateChange((_evt, session) => {
  set('session', session);
  if (session && !state.project) boot();
});
boot();
```

---

## 4. Build sequence

Implementation order, each step ending in a working `index.html`:

1. Login overlay + Supabase session bootstrap (console-log loaded project).
2. STATE store + DATA reads for all entities.
3. ENGINE port + RECALC. Verify computed dates against existing seed.
4. Gantt renderer wired to real activities.
5. Activity table with WBS tree + selection drives Gantt highlight.
6. Side panel feed (read-only, comments + history).
7. View switcher + List view.
8. Calendar view.
9. Lookahead view.
10. Edit Mode toggle + drag-move bars + DB writes + history rows.
11. Drag-resize + draw-dependency + inline edit.
12. Comment composer + delete/deactivate menus.
13. Filters + critical-path toggle wired to data.

Each step keeps the page renderable so we can spot-check in a browser.

---

## 5. Open questions / accepted risks

- **Engine drift.** The ported engine is a separate codebase from
  `src/lib/schedule-engine/`. Risk: behavior drifts over time. Mitigation
  for v1: this UI is a Section-6 mockup; the canonical engine in
  `src/lib` is the one Phase 3 wires to the server. If we ever promote
  this UI to production, replace the inline engine with the bundled
  canonical one.
- **Edit Mode "Discard"** does not roll back DB writes. Documented in UI
  copy. A real undo log is later work.
- **No realtime.** Two users editing simultaneously will overwrite each
  other unless one hits a version conflict and refetches. Acceptable for
  internal demo. Phase 6 fixes it.
- **No project switcher.** Hardcoded to Riverside Office Build.
- **Login is open**: anyone with the anon key + a valid Supabase
  user/password can log in. Production would add SSO + email-domain
  allowlists.
- **WBS rollup.** Min/max approximation only. Weighted % complete deferred.

---

## 6. Success criteria

- Loading `index.html` shows the login card; signing in with
  `scheduler@ihs.test` / `password123` loads the Riverside project.
- The Gantt shows Mobilize (May 22) → Pour Foundations (5-day task starting
  after Mobilize finishes), critical path highlighted in red when toggled.
- Switching to List, Calendar, Lookahead views keeps the same selected
  activity, filters, date window.
- Entering Edit Mode, dragging Mobilize forward by 2 days shifts Pour
  Foundations by 2 days (engine cascade), writes both UPDATE rows and
  two `activity_history` rows to Supabase, and the side panel feed
  reflects them.
- Drawing a dependency from a new activity to an existing one inserts a
  `dependencies` row and re-renders the arrow.
- Posting a comment with internal visibility hides it from a logged-in
  external user (verify by signing in as `tp-viewer@trade.test`).
