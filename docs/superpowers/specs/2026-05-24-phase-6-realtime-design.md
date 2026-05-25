# Phase 6 — Real-time Collaboration (Design Spec)

> **Status:** Draft, pending user review.
> **Scope:** Phase 6 of `docs/SCHEDULING-TOOL-PLAN.md` §8 (Real-time collaboration). Implements §7.5–7.6 of the plan: Supabase Realtime channels, optimistic-concurrency reconciliation, and presence (online + edit-mode awareness).
> **Date:** 2026-05-24
> **Branch:** spec lands on the current `docs/section-5-design` line; implementation will follow on `feat/phase-6-realtime` once Section 5 has merged.

---

## 1. Scope & Decisions

This phase makes two browsers editing the same project stay in sync without clobbering, and surfaces who else is in the project so users can self-coordinate. No new server surface, no change to mutation flow beyond a minimal precondition fix and a `version`-bump on cascade writes. RLS — already the canonical authorization boundary — does the visibility work for the new live stream automatically.

### In scope

- **Single Realtime channel per project** named `project:<uuid>`, mounted at `ScheduleShell` and torn down on unmount.
- **Postgres Changes subscriptions** for six tables — `activities`, `dependencies`, `activity_constraints`, `wbs_nodes`, `comments`, `activity_history` — filtered by `project_id=eq.<uuid>`.
- **Pure reducer** `applyRealtimeEvent(data, event) → data` merges incoming rows into the React Query `BootstrapData` cache.
- **Echo + ordering suppression:**
  - `activities` — version gate (`event.new.version > cached.version` ⇒ accept).
  - Unversioned tables (`dependencies`, `wbs_nodes`, `comments`, `activity_constraints`) — module-level inflight `Map<string, number>` (id → expiry ts) with a 30-second TTL.
  - `activity_history` — append-only; no suppression needed.
- **Cascade writer bumps `version`** on every cascaded activity row so other clients accept the events. Self-echo is dropped by the same version gate.
- **Channel-native presence** via `ch.track()` / `presenceState()`. Payload includes `userId`, `displayName`, `color` (deterministic hash of userId), `editMode`, `joinedAt`.
- **`<PresenceBar />` component** in the `ScheduleShell` toolbar — avatar stack (initials, user color), edit-mode users get a colored ring + pencil overlay; overflow chip beyond 5; hover tooltip with name + "Editing"/"Viewing"; small connection-status dot (green/grey/red).
- **Rejoin / bootstrap race fix** — every `SUBSCRIBED` callback (initial join *and* reconnect) calls `invalidateQueries(["schedule", projectId])` so no events are lost in the window between fetch and subscribe, and a long network drop self-heals on reconnect.
- **`visibilitychange → visible`** triggers a `invalidateQueries` as a paranoia refetch when the tab returns to foreground.
- **Migration** — adds `project_id` (NOT NULL) to `activity_constraints` with a backfill and a SELECT RLS policy; sets `replica identity full` on all six tables; adds them to the `supabase_realtime` publication.
- **Mutation precondition fix** — the `useSaveActivity` and `useToggleDependencyActive` rollback paths must restore only the row being edited, not the entire `BootstrapData` snapshot (which would clobber other-row realtime updates received during the in-flight mutation).
- **Audit** — verify inline-edit cells (`ActivityNameCell`, `DurationCell`, etc.) use uncontrolled inputs (`defaultValue`, not `value`) so a remote update mid-typing doesn't wipe the user's in-progress input.
- **Tests:** unit reducer tests (pure, table-driven); integration hook test (mocked Supabase channel); mutation-rollback integration tests; one two-context Playwright E2E (rename + comment + presence).

### Out of scope (deferred to a future phase)

- **Per-activity presence** ("X is viewing Foundation"). Section §7.6 explicitly defers.
- **Cursor / selection broadcasting.** High event volume, low value pre-lookahead-edit work.
- **Idle detection.** "Online" means "tab open."
- **Hard edit-locks.** §7.6 keeps soft awareness only for v1; version-check + conflict toast remains the safety net.
- **Lookahead sync** (`lookaheads`, `lookahead_tasks`). Overlaps Section 5 v2 work; revisit alongside carry_forward / rollup / readiness.
- **Calendar sync** (`calendars`, `calendar_exceptions`). Schedulers edit calendars rarely; refresh-to-see is acceptable until proven otherwise.
- **RLS-filtered realtime E2E test.** `e3b3b5b` already verifies HTTP-level RLS for internal vs shared comments. The same policies govern Realtime; a duplicate test is not earning its keep.
- **Manual offline / reconnect E2E.** Hook-level integration test covers the SUBSCRIBED handler.

### Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Transport | **Postgres Changes** (option A) | DB is the source of truth; RLS-enforced for free; no server-action shift needed; matches §7.5 "broadcast changed rows" wording. |
| Sync scope | **Schedule core + collab feed** | activities, deps, constraints, wbs, comments, history. Lookaheads/calendars deferred. |
| Engine fields on remote events | **Trust cascade values** | Writer's optimistic recalc + cascade upsert is the source of truth; receivers do not re-run engine on every event. Open issue: cascade rows must bump `version` (below). |
| Echo suppression — activities | **Version gate** | Existing `version` column does the work; no extra state. |
| Echo suppression — unversioned tables | **Inflight Map with 30s TTL** | Tiny module-level state; 30s expiry prevents leaks if echo never arrives. |
| Cascade writer change | **Bump `version` on cascaded rows** | Preserves the simple `version > cached.version ⇒ accept` rule. Other clients now accept the engine-field updates that today's cascade write would deliver as no-ops. |
| Presence scope | **Online + edit-mode** | Matches §7.5 ("who's online and who's currently in Edit Mode"); per-activity presence deferred. |
| `activity_constraints.project_id` | **Add column** (option i) | Cleaner filter, modest migration, future-proofs constraint-related realtime work. |
| Bootstrap race | **invalidate-on-SUBSCRIBED** | One extra refetch (~200ms) per project-open; eliminates the fetch-then-subscribe gap and self-heals on reconnect without extra code. |
| Mutation rollback fix | **In this phase, not a separate cleanup** | The bug only matters once realtime exists; folding it in keeps the change cohesive. |

---

## 2. Background — What Already Exists

### 2.1 Data model & RLS (Phase 2)

- `activities` carries `version` (int, incremented per write) and `deleted_at` (soft delete).
- `dependencies`, `wbs_nodes`, `comments`, `activity_history`, `activity_constraints` exist with appropriate columns. None except `activities` is versioned.
- `comments` and `activity_history` carry `visibility ∈ {internal, shared}` with RLS policies enforcing the distinction (`is_member` for shared; member-with-internal-access for internal). The Phase 4 E2E `e3b3b5b` proves an external user cannot SELECT internal rows.
- `is_member(project_id uuid)` and capability-checking helpers exist as SQL functions (`20260522144357_rls_functions.sql`). All existing `_select` policies use the pattern `using (is_member(project_id))`.

### 2.2 State (Phase 4 / Section 5)

- `Providers` (src/lib/state/providers.tsx) wires a single `QueryClient`. The schedule cache is keyed `["schedule", projectId]` and holds the full `BootstrapData`.
- Mutations (src/lib/state/mutations.ts) write directly to Supabase via `@supabase/supabase-js`, with optimistic patches and version-checked retries on activity writes (`persistVersioned`). Other tables are last-write-wins.
- `useUiStore` (zustand) holds `mode ∈ {view, edit}` and a UUID `editSessionId` minted on `enterEditMode`.
- `runRecalc(data)` (src/lib/state/recalc.ts) runs the pure engine over the cached data; called inside mutations for cascade computation.

### 2.3 What is *not* in place

- No `@supabase/realtime-js` usage anywhere in `src/` (verified via grep — zero matches for `realtime|broadcast|presence`).
- The Supabase client (src/lib/supabase/client.ts) bundles Realtime by default but no channels are opened.
- No `replica identity full` set on any table; `supabase_realtime` publication exists but has no tables added.

---

## 3. Architecture

### 3.1 File layout

```
src/lib/realtime/
├── use-project-channel.ts     // single hook, mounted on ScheduleShell
├── reducers.ts                // pure (data, event) → data
├── reducers.test.ts           // table-driven unit tests
├── echo-set.ts                // inflight Map with TTL
├── presence.ts                // PresencePayload type + deriveColor helper
├── normalize.ts               // Supabase RealtimePostgresChangesPayload → our RealtimeRowEvent
└── use-project-channel.test.ts // hook integration test

src/lib/state/presence-store.ts   // zustand store: online users + connection status

src/components/schedule/
└── PresenceBar.tsx              // avatar stack + connection dot
```

### 3.2 Subscription topology

One channel per project, six bindings + presence + lifecycle:

```ts
const ch = sb.channel(`project:${projectId}`, {
  config: { presence: { key: userId } },
});

for (const table of TABLES) {
  ch.on("postgres_changes",
    { event: "*", schema: "public", table,
      filter: `project_id=eq.${projectId}` },
    (payload) => qc.setQueryData(key, (prev) =>
      prev ? applyRealtimeEvent(prev, normalize(payload, projectId)) : prev));
}

ch.on("presence", { event: "sync" }, () => {
  presenceStore.setOnline(ch.presenceState<PresencePayload>());
});

ch.subscribe(async (status) => {
  if (status === "SUBSCRIBED") {
    presenceStore.setConnection("live");
    void qc.invalidateQueries({ queryKey: ["schedule", projectId] });
    await ch.track({ userId, displayName, color, editMode: store.mode === "edit", joinedAt: new Date().toISOString() });
  } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
    presenceStore.setConnection("offline");
    toast.warn("Live updates disconnected — refresh to reconnect");
  }
});
```

The hook also subscribes to `useUiStore` for `mode` changes and re-tracks the presence payload when edit mode flips.

### 3.3 Reducer contract

```ts
export type RealtimeRowEvent =
  | { table: "activities"; type: "INSERT" | "UPDATE"; new: DbActivity }
  | { table: "activities"; type: "DELETE"; old: { id: string } }
  | { table: "dependencies"; type: "INSERT" | "UPDATE"; new: DbDependency }
  | { table: "dependencies"; type: "DELETE"; old: { id: string } }
  | { table: "activity_constraints"; type: "INSERT" | "UPDATE"; new: DbActivityConstraint }
  | { table: "activity_constraints"; type: "DELETE"; old: { id: string } }
  | { table: "wbs_nodes"; type: "INSERT" | "UPDATE"; new: DbWbsNode }
  | { table: "wbs_nodes"; type: "DELETE"; old: { id: string } }
  | { table: "comments"; type: "INSERT" | "UPDATE"; new: DbComment }
  | { table: "comments"; type: "DELETE"; old: { id: string } }
  | { table: "activity_history"; type: "INSERT"; new: DbActivityHistory };

export function applyRealtimeEvent(data: BootstrapData, event: RealtimeRowEvent): BootstrapData;
```

Per-table merge rules:

| Table | INSERT | UPDATE | DELETE |
|---|---|---|---|
| `activities` | append if id absent | replace by id **iff `event.new.version > cached.version`** | mark `deleted_at` on cached row (soft) |
| `dependencies` | append if id absent and not in `echoSet` | replace by id | mark `deleted_at` |
| `activity_constraints` | append if id absent and not in `echoSet` | replace by id | remove from array |
| `wbs_nodes` | append if id absent and not in `echoSet` | replace by id | mark `deleted_at` |
| `comments` | append to head if id absent and not in `echoSet` | replace by id | mark `deleted_at` |
| `activity_history` | append (no echo check) | n/a | n/a |

**Invariants:**

1. **Pure** — no Supabase client, no React Query, no DOM. Takes data + event, returns new data.
2. **Project guard** — reducer asserts `event.new.project_id === data.project.id` (when the field is present); drops events that don't match. Defense in depth; server-side filter already does this.
3. **Soft-delete preserved** — UI already filters by `deleted_at IS NULL`; DELETE handlers patch `deleted_at` rather than removing the row, so existing rendering pipelines are unaffected.

### 3.4 Echo set

```ts
// src/lib/realtime/echo-set.ts
const inflight = new Map<string, number>();  // id → expiry ms

export function markInflight(id: string) {
  inflight.set(id, Date.now() + 30_000);
}

export function consumeEcho(id: string): boolean {
  const expiry = inflight.get(id);
  if (expiry === undefined) return false;
  inflight.delete(id);
  return expiry > Date.now();   // already expired ⇒ treat as not-in-flight
}

export function _resetForTests() { inflight.clear(); }
```

Mutations call `markInflight(returnedRow.id)` immediately after the supabase insert resolves (specifically: `useInsertDependency`, `usePostComment`, any future `useInsertWbsNode` / `useInsertActivityConstraint`). The reducer calls `consumeEcho(event.new.id)` for INSERT events on unversioned tables; `true` means drop.

### 3.5 Version-bump on cascade writes (writer change)

Today, `useSaveActivity` cascade-writes engine-computed fields with no version bump:

```ts
// existing — does not bump version
await sb.from("activities").upsert(payload);
```

With realtime, other clients have the *old* version cached, but the broadcast event for the cascaded row also has the old version — our `event.new.version > cached.version` gate drops it, leaving other clients stale.

Fix: bump `version` on each cascaded row. Cleanest is an individual `update` per row inside `Promise.all`, since we already know each row's current version from the optimistic recalc:

```ts
await Promise.all(cascadeUpdates.map((a) =>
  sb.from("activities")
    .update({
      planned_start: a.planned_start, planned_finish: a.planned_finish,
      early_start: a.early_start, early_finish: a.early_finish,
      late_start: a.late_start, late_finish: a.late_finish,
      total_float: a.total_float, free_float: a.free_float,
      is_critical: a.is_critical,
      version: a.version + 1,
    })
    .eq("id", a.id)
));
```

Tradeoff: N round-trips instead of one upsert. Typical drag fans out to ~10s of rows; latency impact is ~20–50ms. Acceptable for v1; revisit with an RPC if drag UX degrades.

### 3.6 Presence

```ts
// src/lib/realtime/presence.ts
export interface PresencePayload {
  userId: string;
  displayName: string;
  color: string;       // deterministic hash of userId → 1 of 8 palette colors
  editMode: boolean;
  joinedAt: string;    // ISO
}

const PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#9333ea",
                 "#ea580c", "#0891b2", "#db2777", "#65a30d"];

export function deriveColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return PALETTE[h % PALETTE.length];
}
```

`presence-store.ts` (zustand):

```ts
type ConnectionStatus = "connecting" | "live" | "offline";

interface PresenceStore {
  online: Record<string, PresencePayload>;
  connection: ConnectionStatus;
  setOnline: (raw: Record<string, PresencePayload[]>) => void;  // Supabase returns arrays
  setConnection: (s: ConnectionStatus) => void;
}
```

`setOnline` flattens Supabase's `Record<presenceKey, PresencePayload[]>` into a single entry per userId (we set `presence: { key: userId }` so each user has exactly one entry, but `presenceState()` still returns arrays).

`<PresenceBar />` reads from this store. UI: a horizontal stack of up to 5 avatar circles (rendered with `<div>` + initials and background = user color); overflow chip ("+3"); edit-mode users get a 2px outer ring in their color and a small pencil icon overlay; a connection dot (green/grey/red) sits to the left of the stack. Current user is rendered first with slightly reduced opacity. Hover triggers a tooltip showing the full display name + "Editing"/"Viewing".

---

## 4. Data Flow

### 4.1 Happy path — local write

```
User clicks "rename" → applyOptimisticActivityPatch (cache shows new name)
                    → persistVersioned (update WHERE version=V)
                    → supabase responds with row.version = V+1
                    → cache row replaced with returned row
                    → cascade computed → N individual updates (each bumps version)
                    → history rows inserted

Meanwhile, realtime broadcasts:
  UPDATE activities (the rename) version V+1 → reducer accepts (cache already has V+1, gate: V+1 > V+1 is false → drop). ✓
  UPDATE activities (each cascaded row) version W+1 → reducer accepts (cache has W from optimistic recalc → W+1 > W → accept).
    Note: this re-replaces the row with effectively identical engine fields. No visible flicker; reducer output is deterministic.
  INSERT activity_history (one per changed field) → reducer appends.
```

### 4.2 Happy path — remote write (other user)

```
Other user renames activity X (version V → V+1)
  ⇒ realtime fires UPDATE activities { version: V+1, name: "Foundation North", ... }
  ⇒ reducer compares V+1 > V (cached) → accept, replace
  ⇒ React re-renders ActivityTable, GanttBars

If the other user also moved dates that cascade to our other rows:
  ⇒ a flurry of UPDATE activities events arrive, each with bumped version
  ⇒ reducer accepts each, replaces engine fields
  ⇒ UI updates row-by-row (browser will paint in <1 frame typically)
```

### 4.3 Concurrent write — same row

```
A's cache: version V                B's cache: version V
A starts saving rename "Found-A"    B starts saving duration change
A's optimistic patch applied        B's optimistic patch applied
A's update WHERE version=V succeeds → row now version V+1
  realtime broadcast lands at B before B's persist finishes
  reducer at B: V+1 > V → replace, but B's optimistic patch is lost
B's persistVersioned: update WHERE version=V → 0 rows, hits conflict branch
  refetchRow → V+1
  retry: update WHERE version=V+1, applying B's `vars.patch` → succeeds, row V+2
  cache replaced with V+2 (B's duration change on top of A's rename)
A's cache eventually receives B's V+2 event → accepts → both clients converge
```

This is the existing optimistic-concurrency behavior; realtime makes the loss-of-optimistic-patch-on-B visible *before* B's save fails (rather than only after). Acceptable for v1 — the visual snap-back is informative; we may add a "row changed" toast in v2 if it proves confusing.

### 4.4 Cross-table ordering

Postgres Changes does **not** guarantee ordering across tables. A writer inserts a dependency then cascade-updates an activity; the activity UPDATE can arrive before the dependency INSERT. Each reducer slice is independent; the activity carries its already-computed engine fields, so the Gantt date shift renders correctly even if the dependency arrow pops in one paint later. Documented behavior; no mitigation needed in v1.

---

## 5. Error Handling & Lifecycle

### 5.1 Subscription states

| Status | Action |
|---|---|
| `SUBSCRIBED` | `setConnection("live")`; `invalidateQueries(["schedule", projectId])`; `ch.track(presencePayload)` |
| `CHANNEL_ERROR` | `setConnection("offline")`; `toast.warn("Live updates disconnected — refresh to reconnect")`; do not auto-retry (Supabase client handles it) |
| `TIMED_OUT` | same as `CHANNEL_ERROR` |
| `CLOSED` | no action (expected on unmount) |

### 5.2 Tab visibility

```ts
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void qc.invalidateQueries({ queryKey: ["schedule", projectId] });
  }
});
```

Paranoia refetch on every return-to-foreground. The bootstrap fetch is small and the alternative (track last-event timestamp) is more code for marginal savings.

### 5.3 Mutation rollback (precondition fix)

`useSaveActivity` rollback today:

```ts
qc.setQueryData(["schedule", projectId], data);   // ← restores entire BootstrapData snapshot
```

The captured `data` snapshot was taken before the mutation started. If a realtime update for *another* row arrived during the mutation, restoring the snapshot would silently wipe it. Replace with a per-row restore:

```ts
qc.setQueryData(["schedule", projectId], (cur: BootstrapData | undefined) => {
  if (!cur) return cur;
  const snapshotRow = data.activities.find((a) => a.id === vars.id)!;
  return {
    ...cur,
    activities: cur.activities.map((a) => a.id === vars.id ? snapshotRow : a),
  };
});
```

Same shape change in `useToggleDependencyActive` rollback (src/lib/state/mutations.ts:349). The other mutations (`useInsertDependency`, `useDeleteActivity`, `usePostComment`) do not snapshot-replace the full cache — they patch single rows on failure, which is already correct.

### 5.4 Bad payload defense

The reducer is the trust boundary. Two cheap guards:

1. Project ID mismatch — `if (event.new.project_id && event.new.project_id !== data.project.id) return data;`. Belt-and-suspenders against any future filter bug.
2. Type assertions on the discriminated `RealtimeRowEvent` keep the compiler honest; bad runtime shapes get cast through `normalize.ts` (no `any`).

### 5.5 Echo-set TTL

The 30s expiry in `consumeEcho` ensures a dropped websocket can't permanently retain an id. No correctness consequence — UUIDs don't collide — but it tidies memory over long sessions.

---

## 6. Migration

`20260524nnnnnn_phase6_realtime.sql`:

```sql
-- 1. Add project_id to activity_constraints (currently keyed only by activity_id).
alter table public.activity_constraints
  add column project_id uuid references public.projects(id) on delete cascade;

update public.activity_constraints ac
  set project_id = a.project_id
  from public.activities a
  where ac.activity_id = a.id and ac.project_id is null;

alter table public.activity_constraints
  alter column project_id set not null;

create index activity_constraints_project_id_idx
  on public.activity_constraints (project_id);

-- 2. RLS SELECT policy for activity_constraints (mirrors other tables).
drop policy if exists activity_constraints_select on public.activity_constraints;
create policy activity_constraints_select on public.activity_constraints
  for select to authenticated
  using (is_member(project_id));

-- 3. replica identity full — so DELETE and UPDATE events ship complete row data.
alter table public.activities             replica identity full;
alter table public.dependencies           replica identity full;
alter table public.activity_constraints   replica identity full;
alter table public.wbs_nodes              replica identity full;
alter table public.comments               replica identity full;
alter table public.activity_history       replica identity full;

-- 4. Add tables to the supabase_realtime publication.
alter publication supabase_realtime add table public.activities;
alter publication supabase_realtime add table public.dependencies;
alter publication supabase_realtime add table public.activity_constraints;
alter publication supabase_realtime add table public.wbs_nodes;
alter publication supabase_realtime add table public.comments;
alter publication supabase_realtime add table public.activity_history;
```

If Supabase CLI rejects mixing DDL and publication ALTER in one file, split into `…_phase6_realtime_a.sql` (DDL) and `…_phase6_realtime_b.sql` (publication).

App-code change paired with the migration:
- Add `project_id: string` to `DbActivityConstraint` in src/lib/schedule/types.ts.
- Update the bootstrap fetch's constraint SELECT column list (in `src/lib/schedule-server/get-project-schedule/...`) to include `project_id`.

---

## 7. Testing

### 7.1 Unit — `src/lib/realtime/reducers.test.ts`

Table-driven, ~30 cases. Sample shape:

```ts
describe("applyRealtimeEvent — activities", () => {
  it("drops UPDATE with version <= cached", () => { ... });
  it("accepts UPDATE with version > cached", () => { ... });
  it("appends INSERT", () => { ... });
  it("soft-deletes on DELETE", () => { ... });
  it("drops event with mismatched project_id", () => { ... });
});

describe("applyRealtimeEvent — dependencies", () => {
  it("drops INSERT in echo set", () => { ... });
  it("consumes echo entry on drop", () => { ... });
  it("accepts INSERT not in echo set", () => { ... });
  // ...
});
```

Cover all six tables × INSERT/UPDATE/DELETE (where applicable). Echo-set tests use `vi.useFakeTimers()` for the 30s TTL.

### 7.2 Integration — `src/lib/realtime/use-project-channel.test.ts`

Mock the Supabase channel as `{ on, subscribe, track, untrack, unsubscribe, presenceState }` — each method records calls; the test triggers callbacks manually. Assertions:

- Subscribes to all six tables with correct `project_id=eq.<uuid>` filter.
- On SUBSCRIBED: tracks presence; invalidates queries.
- Forwards postgres_changes payloads through `normalize` + `applyRealtimeEvent` → setQueryData.
- On presence sync: writes to `usePresenceStore.setOnline`.
- On unmount: untracks + unsubscribes.
- On visibilitychange → visible: invalidates queries.
- Reconnect (second SUBSCRIBED): re-invalidates + re-tracks.

### 7.3 Integration — mutation rollback fix

Two new tests in `src/lib/state/mutations.test.ts`:

- `useSaveActivity` rollback preserves other-row realtime updates received during the mutation.
- `useToggleDependencyActive` rollback preserves other-row realtime updates received during the mutation.

Setup: pre-populate cache with rows A and B. Begin save on A with a stub that resolves to an error. Before the error returns, manually apply a realtime update to B via `applyRealtimeEvent`. After the rollback resolves, assert A reverted and B retained the realtime change.

### 7.4 E2E — `tests/realtime.e2e.ts`

One two-context Playwright test:

```
Context Alice                  Context Bob
  log in (scheduler)            log in (scheduler)
  open /project/X               open /project/X
  enter Edit Mode               wait for Alice avatar with editing ring
  rename activity A             wait for "A → new name" in row
                                add comment "hello"
  wait for "hello" in feed
  exit Edit Mode                verify Alice's editing ring clears
```

Reuses existing auth fixtures. ~80 lines.

### 7.5 Manual smoke (Task in plan)

Before opening the PR:

- Open the same project in two browsers as two real internal users; rename activity in A, see it in B.
- Confirm presence avatars appear and editing indicator works.
- Open as an external user in B; confirm internal comments posted by A do NOT appear in B's feed.
- Kill A's network (devtools offline/online); confirm edits made by B during A's offline window appear after A reconnects.

---

## 8. Inline-Edit Audit Item

The reducer can replace a cached row mid-keystroke. If an inline-edit input is *controlled* (`value={row.name}`), the cache update would reset the user's in-progress text. The implementation plan must include a Task that:

1. Greps `src/components/schedule/` for inline-editing inputs.
2. For each, confirms it uses `defaultValue=` (uncontrolled) + `onBlur`/`onKeyDown` to commit, not `value=` + `onChange` writing to local state.
3. Converts any controlled-pattern offenders.

Existing suspects (from Phase 5 commits): `ActivityNameCell`, `DurationCell`, possibly cells in `LookaheadTaskRow` (deferred — lookaheads not synced in v1).

---

## 9. Summary

| Area | v1 decision |
|---|---|
| Transport | Postgres Changes |
| Scope | activities, dependencies, activity_constraints, wbs_nodes, comments, activity_history |
| Engine fields on remote events | Trust cascade-written values |
| Cascade writer change | Bump `version` on each cascaded row |
| Echo suppression | Version gate for activities; inflight Map with 30s TTL for others |
| Presence | Online + edit-mode; channel-native; avatar stack with edit ring + connection dot |
| Bootstrap race | `invalidateQueries` on every SUBSCRIBED |
| Visibility | `invalidateQueries` on tab return |
| RLS | Reused; new SELECT policy on `activity_constraints` only |
| Migration | `project_id` on constraints; `replica identity full` on 6 tables; publication ALTER |
| Mutation rollback fix | Per-row restore in `useSaveActivity` + `useToggleDependencyActive` |
| Audit | Inline-edit cells use `defaultValue` (uncontrolled) |
| Out of scope (v2) | Per-activity presence, cursor broadcasting, idle detection, hard locks, lookahead sync, calendar sync |
