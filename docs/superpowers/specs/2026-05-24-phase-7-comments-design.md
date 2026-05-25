# Phase 7 — Comments Side Panel & Visibility, Field-Ready v1 (Design Spec)

> **Status:** Draft, pending user review.
> **Scope:** Phase 7 of `docs/SCHEDULING-TOOL-PLAN.md` §8. Finishes §2.4 (the unified side-panel feed, comment visibility, and Edit Mode change-event grouping) on top of the schema, RLS, and realtime plumbing already shipped in Phases 2/4/6.
> **Date:** 2026-05-24
> **Branch:** implementation lands on `feat/phase-7-comments` from `origin/main`.

---

## 1. Scope & Decisions

The "external user cannot see internal comments at the DB level" gate from §8 already passes (commit `e3b3b5b`). This phase is the field-usability polish needed to actually use the side panel during day-to-day scheduling: see *who* posted what, *when a session was edited and why*, *filter out the chatter you don't care about*, and *fix your own typos*.

### In scope

- **Author display** in the feed — name + deterministic color chip per comment / history row. Bootstrap adds a `users` lookup so the side panel and `PresenceBar` share the same source.
- **Edit-session grouping** — consecutive `activity_history` rows sharing an `edit_session_id` collapse into one `<EditSessionGroup>` card with a header (`"{author} made {n} changes · {time}"`) and the optional session note. Single-row sessions render flat.
- **Done-Save session-note modal** — clicking "Done" on the Edit Mode banner opens a blocking `<SessionNoteModal>` with a textarea + Save / Skip. Either button calls `exitEditMode`; Save first runs `useSetSessionNote`. Skipped silently if the session produced zero history rows.
- **Visibility filter** in the feed — chips `all / internal / shared`, alongside the existing `all / comments / history` kind filter.
- **Composer reads project default** — initial visibility in `<CommentComposer>` comes from `bootstrap.project.comment_visibility_default` (currently hardcoded to `"internal"`).
- **Comment edit + soft-delete affordances** — pencil + trash buttons on own comments. Edit updates `body` + `edited_at` and renders `(edited)`. Delete sets `deleted_at` and renders a `[deleted by author]` tombstone (does **not** filter the row out, so threads stay continuous).
- **History row visibility from project setting** — `appendHistoryRows` reads `bootstrap.project.comment_visibility_default` instead of hardcoding `"shared"`. Same knob governs both composer default and history rows; flagged below as a single-knob risk.
- **Realtime `activity_history` UPDATE** — new event variant + reducer case so a session-note backfill propagates to observers without a refresh.
- **Tests** — Vitest for new components and mutations; reducer test for `activity_history` UPDATE; Playwright extension covering grouped header + session note + own-comment edit/delete; external-user E2E extension asserting the `internal` filter chip is hidden.

### Out of scope (deferred)

- **Threaded replies UI.** `parent_comment_id` is in the schema; no UI for it yet.
- **@mentions + notifications.** No mention parsing, no notification dispatch.
- **Comment attachments.** `attachments` table exists; no upload UI.
- **Per-project `history_visibility_default` column.** Today both knobs (composer default and history visibility) read from `projects.comment_visibility_default`. If this turns out to be too coarse, add a separate column later — flagged in §8.
- **Recovery flow when Edit Mode exits via navigation / refresh.** The session note is lost in that path; acceptable for v1.

### Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Scope | **Field-ready v1** | The DB / RLS gate already passes; this phase makes the feature usable, not just legally compliant. |
| PR shape | **Single PR on `feat/phase-7-comments`** | Scope is ~8-12 files; splitting dulls the §2.4 "one experience" framing. |
| Session-note collection | **Blocking modal with Skip** | Most explicit; matches §2.4's "prompt the user" wording. Inline banner is too easy to miss. |
| Edit / delete UI | **Edit in place + soft-delete tombstone** | Matches §2.5 recommendation; preserves audit + thread continuity. |
| History visibility source | **`projects.comment_visibility_default`** | One knob, simplest change. Splittable later if needed. |
| Author display source | **`bootstrap.users` lookup map** | Single round-trip; reuses for `PresenceBar`; comments/history rows stay normalized. |

### Phase 7 "done when"

A scheduler in tab A enters Edit Mode, edits 5 activities, clicks Done, types "re-sequenced concrete," saves. Within ~1s an internal viewer in tab B sees a single grouped header `"Tanner made 5 changes · re-sequenced concrete"`. Expand reveals the 5 underlying rows. The external trade-partner viewer in tab C sees nothing from this session (assuming default `internal` visibility) and sees no `internal` chip in their filter row. The scheduler edits their own earlier comment, sees `(edited)`; soft-deletes it, sees `[deleted by author]`. The `external-user.spec.ts` gate still passes.

---

## 2. Data Model

**No new tables. No new columns. One new RLS policy.** Everything else Phase 7 needs already exists in `supabase/migrations/20260522142709_core.sql` and `20260522143858_collaboration.sql`:

- `comments.edited_at`, `comments.deleted_at` — already nullable timestamps.
- `comments_update` policy (in `20260522145151_rls_policies.sql:232-234`) `using (author_user_id = auth.uid()) with check (author_user_id = auth.uid())` — already covers body edits **and** soft-delete (which is itself an UPDATE setting `deleted_at`).
- `activity_history.edit_session_id`, `activity_history.session_note` — already populated by `appendHistoryRows` for the session id, currently always `null` (or `"engine_cascade"` for cascades) for the note.
- `projects.comment_visibility_default` (default `'internal'`) — already in the schema; the composer and `appendHistoryRows` simply do not read it yet.

The only schema-adjacent change is **a new RLS policy for UPDATE on `activity_history`**. Today there is no `activity_history_update` policy; PostgreSQL denies UPDATE by default under RLS. We add one:

```sql
create policy activity_history_update on activity_history for update to authenticated
  using (changed_by = auth.uid())
  with check (changed_by = auth.uid());
```

Author-only, by the same shape as `comments_update`. Lands as `supabase/migrations/<ts>_phase7_history_update_policy.sql`.

---

## 3. Bootstrap

`src/lib/schedule/bootstrap.ts` already fetches `projects`, `activities`, `dependencies`, `wbs_nodes`, `activity_constraints`, `lookaheads`, `lookahead_tasks`, `comments`, `activity_history` in parallel. Add one parallel fetch and one type extension:

```ts
// new fetch
const usersPromise = sb
  .from("users")
  .select("id, display_name, company_id, color");
  // (no company-type column in users; resolve via companies join if needed, otherwise rely on company_id mapping client-side)
```

Distinct user ids are bounded by `members(project_id = X)` ∪ `comments(project_id = X).author_user_id` ∪ `activity_history(project_id = X).changed_by`. The simplest fetch is "all users visible to me under RLS" — `users` already has RLS that scopes to co-members of any project I'm in, so this returns exactly the people who can appear in feed metadata.

Type addition in `src/lib/schedule/types.ts`:

```ts
export interface UserLookupEntry {
  id: string;
  display_name: string;
  company_id: string;
  color: string;             // hex from a deterministic hash of id (matches PresenceBar.deriveColor)
}

export interface BootstrapData {
  // ... existing fields
  users: Record<string, UserLookupEntry>;
}
```

The lookup is built server-side as `Object.fromEntries(rows.map(r => [r.id, { ...r, color: deriveColor(r.id) }]))` to keep render-time work down.

`PresenceBar` currently calls `deriveColor(userId)` inline; it can keep doing that or read from the lookup — not part of this phase's required changes.

---

## 4. Components

### Modify

| File | Change |
|---|---|
| `src/components/schedule/SidePanel/SidePanel.tsx` | Add visibility-filter chip row (`all / internal / shared`). Replace the inline render of history `FeedItem`s with a grouping pass that produces either a `<EditSessionGroup>` (n ≥ 2 history rows sharing a non-null `edit_session_id`) or a single `<CommentItem>` / inline history row. Render author name + color chip from `bootstrap.users`. |
| `src/components/schedule/SidePanel/CommentComposer.tsx` | Initial `visibility` state reads `bootstrap.project.comment_visibility_default`. (Composer receives `defaultVisibility` as a prop from `SidePanel`.) |
| `src/components/schedule/EditModeBanner.tsx` | "Done" button no longer calls `exitEditMode` directly; it opens `<SessionNoteModal>` via local state. Modal Save/Skip then calls `exitEditMode`. If the current session produced zero history rows (computed from `bootstrap.history.filter(h => h.edit_session_id === current)`), skip the modal and `exitEditMode` directly. |
| `src/lib/state/mutations.ts` | `appendHistoryRows` reads visibility from a passed-in `projectVisibilityDefault: "internal" \| "shared"` argument (call sites pass `bootstrap.project.comment_visibility_default`). New hooks: `useUpdateComment`, `useSoftDeleteComment`, `useSetSessionNote`. |
| `src/lib/realtime/events.ts` | Add union variant `{ table: "activity_history"; type: "UPDATE"; new: DbActivityHistory }`. |
| `src/lib/realtime/reducers.ts` | Handle the new UPDATE — find the row by `id` in `bootstrap.history`, replace; if not found, no-op (echo / late-bind). |
| `src/lib/realtime/normalize.ts` | Allow `activity_history` UPDATE through (currently restricted to INSERT). |

### Create

| File | Responsibility |
|---|---|
| `src/components/schedule/SidePanel/EditSessionGroup.tsx` | Collapsible card. Props: `{ author: UserLookupEntry, when: string, rows: HistoryRow[], note: string \| null }`. Header line: `"{display_name} made {rows.length} changes · {time}"` + note on a second line. Collapsed by default. Visibility chip = visibility of the group (all rows share it). |
| `src/components/schedule/SidePanel/CommentItem.tsx` | Render one comment. Props: `{ comment, author, isOwn, onStartEdit, onSoftDelete }`. Inline edit textarea when editing; `(edited)` hint when `edited_at != null`; `[deleted by author]` tombstone when `deleted_at != null` (renders body greyed out, no edit/delete buttons). |
| `src/components/schedule/SessionNoteModal.tsx` | Dialog with textarea (autofocus), `Save` and `Skip` buttons. Enter = Save. Esc = Skip. Calls `useSetSessionNote` on Save with the current `editSessionId`; calls `exitEditMode` either way. |

`SidePanel` now reads `selectedActivityId`, `view filter`, `kind filter`, and `visibility filter` from `useUiStore`; the visibility filter is a new field in the store.

---

## 5. State & Mutations

### `ui-store.ts` addition

```ts
visibilityFilter: "all" | "internal" | "shared";   // default "all"
setVisibilityFilter: (v: "all" | "internal" | "shared") => void;
```

### New mutation hooks (in `src/lib/state/mutations.ts`)

| Hook | SQL shape | Optimistic cache patch |
|---|---|---|
| `useUpdateComment(projectId)` | `update comments set body = ?, edited_at = now() where id = ?` (RLS enforces author) | Replace the comment in `bootstrap.comments` with `{...prev, body, edited_at: new Date().toISOString()}`. On error: rollback + toast. |
| `useSoftDeleteComment(projectId)` | `update comments set deleted_at = now() where id = ?` (RLS enforces author) | Set `deleted_at` in cache. On error: rollback + toast. |
| `useSetSessionNote(projectId)` | `update activity_history set session_note = ? where edit_session_id = ? and changed_by = auth.uid()` | Find all rows in `bootstrap.history` matching `(edit_session_id, changed_by = self)`; patch their `session_note`. On error: rollback + toast. |

All three use the existing pattern in `mutations.ts` — `useMutation` with an inline error branch that calls `toast.error("…")`. All three call `markInflight(id)` on the returned rows so the realtime echo doesn't bounce them back.

### `appendHistoryRows` signature change

Today: `appendHistoryRows(rows, sessionId, visibility, userId)` with `visibility` typically hardcoded as `"shared"` at call sites.
New: `appendHistoryRows(rows, sessionId, projectVisibilityDefault, userId)`. Call sites read `useScheduleBootstrap().project.comment_visibility_default` (or pull it from the existing query cache via `qc.getQueryData(["schedule", projectId])`).

### Edit Mode flow

```
User clicks Done in EditModeBanner
  └─ if (bootstrap.history.some(h => h.edit_session_id === current)):
       open SessionNoteModal({ editSessionId: current, changeCount })
         ├─ Save("re-sequenced concrete"):
         │     useSetSessionNote.mutate({ editSessionId: current, note }) → exitEditMode()
         └─ Skip: exitEditMode()
     else:
       exitEditMode()        // no changes, no prompt
```

`editSessionId` stays in the store until `exitEditMode` runs. The modal owns its open/close state via a local `useState` in `EditModeBanner`; no global "modal stack" needed.

---

## 6. Realtime

`src/lib/realtime/events.ts` already lists `activity_history` as a participating table but only models INSERT (`events.ts:26`). The session-note backfill is an UPDATE on multiple rows, so observers would otherwise stay stale until they refetch.

**Changes:**
1. `RealtimeRowEvent` gains `{ table: "activity_history"; type: "UPDATE"; new: DbActivityHistory }`.
2. `normalize.ts` stops restricting `activity_history` to INSERT — the existing INSERT branch stays; the UPDATE branch falls through to a generic handler that returns the typed payload.
3. `reducers.ts` adds a case under `activity_history` → `UPDATE`: find `bootstrap.history` by `id`, replace it; otherwise no-op.
4. The Phase 6 `useProjectChannel` already subscribes to the wildcard `*` event on `activity_history` (it does for every table in the publication; verify in `use-project-channel.ts` before implementation), so no subscription change is needed.

**Echo / dedup:** `useSetSessionNote` calls `markInflight(rowId)` on each updated history row's id so the writer doesn't fight its own optimistic patch when the UPDATE event echoes back. `markInflight` already supports row-id marking; no helper change required.

---

## 7. Testing

### Vitest (unit + component)

| File | Cases |
|---|---|
| `src/components/schedule/SidePanel/EditSessionGroup.test.tsx` | Single-row sessions render flat (no expand chrome). Multi-row sessions render collapsed by default with the right header + count. Click expand → rows visible. Note present → renders on header. Note absent → header only. |
| `src/components/schedule/SidePanel/SessionNoteModal.test.tsx` | Save calls `useSetSessionNote` with the current id + note; Skip does not. Enter triggers Save; Esc triggers Skip. Empty body + Save → still calls (server stores empty string ↔ null choice flagged below). |
| `src/components/schedule/SidePanel/CommentItem.test.tsx` | Own comment renders edit + delete buttons; non-own does not. Edit toggles the textarea; Save calls `useUpdateComment`; Cancel reverts. Delete calls `useSoftDeleteComment` (no confirm dialog in v1). `edited_at` set → renders `(edited)`. `deleted_at` set → renders tombstone, no buttons. |
| `src/lib/state/mutations.update-comment.test.ts` | Happy path patches cache; error path rolls back + toasts. |
| `src/lib/state/mutations.soft-delete-comment.test.ts` | Happy path sets `deleted_at`; error path rolls back. |
| `src/lib/state/mutations.set-session-note.test.ts` | Patches all matching history rows in cache; error path rolls back all. |
| `src/lib/realtime/reducers.test.ts` | Add case: `activity_history` UPDATE replaces row by id; UPDATE for unknown id is a no-op. |

### Playwright

Extend `tests/e2e/scheduler-happy-path.spec.ts`:

1. Login as `scheduler@ihs.test`.
2. Enter Edit Mode; drag three activities to new dates (or use the existing inline-edit path).
3. Click Done → modal appears.
4. Type `"re-sequenced concrete"`; click Save.
5. Assert exactly one group card in SidePanel with header containing `"made 3 changes"` and `"re-sequenced concrete"`.
6. Expand → assert 3 history rows visible.
7. Post a project comment. Hover the comment → edit button visible. Click edit → change body → Save. Assert `(edited)` rendered.
8. Delete the same comment → assert `[deleted by author]` rendered.

Extend `tests/e2e/external-user.spec.ts`:

1. Login as `tp-viewer@trade.test`.
2. Assert the visibility-filter chip row does **not** include an `internal` option.
3. Assert no `EditSessionGroup` from a default-internal session is visible.

### Acceptance check

The Phase 7 "done when" in §1 runs through the Playwright happy-path verbatim. If it passes, the phase is done.

---

## 8. Risks & Open Decisions

- **Single-knob history visibility.** Both composer default and `appendHistoryRows` read from `projects.comment_visibility_default`. If a project wants "all comments default internal, but my schedule changes default shared," they can't express that with one knob. Mitigation: add a `history_visibility_default` column later; existing rows + the one-knob behavior stay backwards-compatible. Flagged in §2.5 of the master plan.
- **Edit Mode exit via browser refresh / nav.** Session note is lost (modal never appears). Acceptable for v1. Phase 11 could add an `editSessionId` persistence layer + a "you left a session open — add a note?" recovery on next load.
- **Author-only edits in a multi-internal-user world.** RLS allows only the author to edit/soft-delete their own comments. Internal Project Admins cannot remove an inappropriate comment. Confirmed acceptable for v1; a future moderation policy lives in Phase 11.
- **History UPDATE echo timing.** If a writer dispatches `useSetSessionNote` and a parallel cascade write lands between optimistic patch and server response, the realtime UPDATE for the cascade row could overwrite the session_note patch on the actor's machine. Mitigation: `markInflight(historyRowId)` for each session-note-targeted row keeps the receiver from accepting echoes during the in-flight window. Validate in implementation.
- **Empty session-note save vs. Skip.** A user could click Save with an empty textarea. We treat that as Skip (no mutation fires) rather than persisting an empty-string note. Surfaced in the `SessionNoteModal.test.tsx` cases.
- **Comment delete: confirmation?** v1 deletes immediately on click. Soft-delete is reversible by a follow-up post, but accidental clicks are still annoying. Considered a "v1 acceptable" trade-off; revisit if it causes friction.

---

## 9. File map

### To create

| File | Purpose |
|---|---|
| `supabase/migrations/<ts>_phase7_history_update_policy.sql` | Adds `activity_history_update` RLS policy (`changed_by = auth.uid()`). |
| `src/components/schedule/SidePanel/EditSessionGroup.tsx` | Collapsible grouped-history card. |
| `src/components/schedule/SidePanel/EditSessionGroup.test.tsx` | Component tests. |
| `src/components/schedule/SidePanel/CommentItem.tsx` | Single-comment renderer with own-comment edit + delete. |
| `src/components/schedule/SidePanel/CommentItem.test.tsx` | Component tests. |
| `src/components/schedule/SessionNoteModal.tsx` | Done-Save modal. |
| `src/components/schedule/SessionNoteModal.test.tsx` | Component tests. |
| `src/lib/state/mutations.update-comment.test.ts` | Mutation test. |
| `src/lib/state/mutations.soft-delete-comment.test.ts` | Mutation test. |
| `src/lib/state/mutations.set-session-note.test.ts` | Mutation test. |

### To modify

| File | Change |
|---|---|
| `src/lib/schedule/bootstrap.ts` | Fetch `users` lookup; build map. |
| `src/lib/schedule/types.ts` | `BootstrapData.users: Record<string, UserLookupEntry>`. |
| `src/lib/state/ui-store.ts` | Add `visibilityFilter` + setter. |
| `src/lib/state/mutations.ts` | New hooks; `appendHistoryRows` signature change; call sites updated. |
| `src/lib/realtime/events.ts` | Add `activity_history` UPDATE variant. |
| `src/lib/realtime/normalize.ts` | Allow `activity_history` UPDATE. |
| `src/lib/realtime/reducers.ts` | Handle `activity_history` UPDATE. |
| `src/lib/realtime/reducers.test.ts` | Add UPDATE test case. |
| `src/components/schedule/SidePanel/SidePanel.tsx` | Visibility filter chips; group history rows into `<EditSessionGroup>`; render author + color; use `CommentItem` for comments. |
| `src/components/schedule/SidePanel/CommentComposer.tsx` | Initial visibility from project default (passed as prop). |
| `src/components/schedule/EditModeBanner.tsx` | Done → `SessionNoteModal` → `exitEditMode`. |
| `tests/e2e/scheduler-happy-path.spec.ts` | Add session-note + edit/delete-comment flow. |
| `tests/e2e/external-user.spec.ts` | Assert no internal filter chip; no internal-session groups. |

### Unchanged

- All Phase 1 engine code.
- All Phase 2 schema except the one new RLS policy.
- All Phase 3 server pipeline + RPC.
- All Phase 4 components outside SidePanel + EditModeBanner.
- All Phase 5 inline-edit cells.
- All Phase 6 channel mounting + presence; only reducers / events / normalize touched.

---

## 10. Hand-off

After user spec approval, hand off to `superpowers:writing-plans` to produce the implementation plan at `docs/superpowers/plans/2026-05-24-phase-7-comments.md`.
