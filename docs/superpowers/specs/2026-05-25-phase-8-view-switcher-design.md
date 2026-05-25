# Phase 8 — View Switcher State Preservation (Design Spec)

**Date:** 2026-05-25
**Roadmap reference:** `docs/SCHEDULING-TOOL-PLAN.md` §6.4, §8 (Phase 8)
**Status:** Design — ready for plan

---

## 0. Context

Phase 4 already shipped the view-switcher chrome and stub implementations of all four views:

- `ui-store.view` enumerates `gantt | list | calendar | lookahead`, with `setView`.
- `Toolbar.tsx` renders the four view buttons wired to `setView`.
- `ScheduleApp.tsx` conditionally mounts `<GanttChart>`, `<ListView>`, `<CalendarView>`, `<LookaheadView>`.
- `ListView` and `CalendarView` already read `selectedActivityId` and `filters.criticalOnly` from the store and highlight selection / apply the filter.

Phase 8's roadmap acceptance criterion is narrow:

> **Done when:** flipping views keeps filters/selection and renders the same data.

This spec therefore defines the **minimum** changes needed to close the gap between the current behavior and that acceptance criterion. Larger §6.4 polish items (multi-day spanning bars in the calendar, `+N more` expander, toolbar-level Today/zoom controls, surfaced trade/responsible-party filters) are explicitly deferred.

---

## 1. Goals

1. The visible date window in `CalendarView` survives a view switch (today it lives in component-local `useState` and resets to project start on every remount).
2. An end-to-end test asserts that filter + selection + calendar anchor all persist across `Gantt → Calendar → Gantt → List → Calendar` round-trips.

**Revision note (post-commit):** `GanttBar.tsx` already reads `selectedActivityId` from `ui-store` and applies `ring-2 ring-sky-400` when selected (see `GanttBar.tsx:21,26,129,159`). The original spec listed Gantt-selection highlighting as a goal; it is in fact already satisfied. Goal removed.

Non-goals (explicitly deferred):

- Multi-day activity bars spanning calendar cells.
- `+N more` overflow expansion popover.
- Toolbar-level Today / zoom controls.
- Surfacing `filters.trade` / `filters.responsibleCompanyId` in the toolbar.
- Gantt horizontal scroll-to-date driven by the shared anchor (see §5).
- `LookaheadView` selection wiring — out of scope, Phase 9 will rework that view.

---

## 2. Architecture

### 2.1 Shared date anchor in `ui-store`

Add a single new piece of state and one action:

```ts
// src/lib/state/ui-store.ts

interface UiState {
  // ... existing fields
  dateAnchor: string; // ISO yyyy-mm-dd. "" until hydrated.
}

interface UiActions {
  // ... existing actions
  setDateAnchor: (iso: string) => void;
}

const initialState: UiState = {
  // ... existing initial values
  dateAnchor: "",
};

// in the create() body:
setDateAnchor: (iso) => set({ dateAnchor: iso }),
```

`dateAnchor` is always the **first day of the month** the calendar is anchored to (ISO `yyyy-mm-01`). The calendar view is responsible for normalizing to month-start when it writes; consumers can rely on the invariant.

### 2.2 Hydration

`ScheduleApp.tsx` already runs an effect to load `currentUserId`. Add an analogous one-shot hydration effect:

```ts
const dateAnchor = useUiStore((s) => s.dateAnchor);
const setDateAnchor = useUiStore((s) => s.setDateAnchor);

useEffect(() => {
  if (dateAnchor === "") {
    setDateAnchor(monthStartIso(bootstrap.project.project_start));
  }
}, [dateAnchor, setDateAnchor, bootstrap.project.project_start]);
```

A small helper `monthStartIso(iso: string): string` lives next to the existing date helpers (either `src/components/schedule/Gantt/layout.ts` if that's already a date-utility home, or inlined in `CalendarView` and re-exported). The decision is left to implementation; whatever keeps imports tight.

**Why lazy-init in the effect rather than passing the initial value to a store factory:** the current store is imported directly in many components (`useUiStore((s) => …)`). Converting it to a factory + Provider would touch every consumer for one new field. The lazy-init pattern is consistent with how `currentUserId` is handled in the same file.

**Trade-off acknowledged:** there is one render where `dateAnchor === ""`. `CalendarView` must tolerate that — see §2.3.

### 2.3 `CalendarView` reads/writes the shared anchor

Replace the local `useState`:

```ts
// before
const [anchor, setAnchor] = useState(() => startOfMonthUtc(bootstrap.project.project_start));

// after
const dateAnchorIso = useUiStore((s) => s.dateAnchor);
const setDateAnchor = useUiStore((s) => s.setDateAnchor);
const anchor = startOfMonthUtc(
  dateAnchorIso || bootstrap.project.project_start, // fall back during the one render before hydration
);
```

`move(months)` becomes:

```ts
function move(months: number) {
  const next = new Date(anchor);
  next.setUTCMonth(next.getUTCMonth() + months);
  setDateAnchor(isoOf(next)); // already month-start because we incremented from one
}
```

The "Today" button (still inside the calendar header for now) calls `setDateAnchor(monthStartIso(bootstrap.project.project_start))`.

### 2.4 Gantt selection highlight — already done

`GanttBar.tsx` (lines 21, 26, 129, 159) already reads `selectedActivityId` and applies `ring-2 ring-sky-400` when the bar's activity is selected, including the milestone variant. No work needed.

### 2.5 Gantt is **not** scroll-driven by `dateAnchor` in Phase 8

The "Done when" criterion says "renders the same data," not "scrolls to the same date." `GanttChart` today is a single horizontally-scrollable strip from `project.project_start`; it has no notion of a "current month." Adding scroll-to-anchor logic risks visual jitter and is out of scope. A future Gantt-polish pass can subscribe `GanttChart` to `dateAnchor` via a `useEffect` that calls `container.scrollTo({ left: dayOffset * DAY_W })`.

---

## 3. Components touched

| File                                                         | Change                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `src/lib/state/ui-store.ts`                                  | Add `dateAnchor`, `setDateAnchor`, initial value `""`.             |
| `src/lib/state/ui-store.test.ts`                             | Add unit test for `setDateAnchor` and initial-state default.        |
| `src/components/schedule/ScheduleApp.tsx`                    | Hydration effect: seed `dateAnchor` from `project.project_start`.  |
| `src/components/schedule/Calendar/CalendarView.tsx`          | Replace local `anchor` `useState` with store-backed value + setter. |
| `tests/e2e/view-switcher-persistence.spec.ts` *(new)*        | E2E persistence test (§4).                                          |

Estimated diff size: ~60–90 LOC (excluding the e2e test). `GanttBar` selection highlight is already implemented and not modified.

---

## 4. Testing strategy

### 4.1 Unit (`vitest`)

`ui-store.test.ts`:

- `dateAnchor` is `""` in the initial state (no implicit project knowledge in the store).
- `setDateAnchor("2026-07-01")` updates state and does not disturb other fields.

### 4.2 E2E (`playwright`)

New file `tests/e2e/view-switcher-persistence.spec.ts`. Follow the scheduler-session fixture pattern used in `tests/e2e/scheduler-happy-path.spec.ts`.

Steps:

1. Sign in as a scheduler and load a seeded project that contains at least one critical activity.
2. In the default Gantt view, toggle Critical Path **on** via the toolbar; assert the toolbar button's `aria-pressed="true"`.
3. Switch to **List**. Because `ListView` honors `criticalOnly`, the visible rows will all be critical — click any one. Assert it is highlighted (`bg-sky-50`).
4. Switch to **Calendar**; advance month forward twice via the `>` chevron. Capture the rendered month label (e.g., "July 2026").
5. Switch to **Gantt**. Assert: Critical Path toggle still pressed (`aria-pressed="true"`); the previously-selected bar shows the `ring-sky-400` highlight.
6. Switch back to **Calendar**. Assert: the rendered month label still reads "July 2026"; the selected activity chip (if visible in that month) still shows the selection ring.
7. Switch to **List**. Assert: the same row still highlighted.

The three pieces of state under test (`filters.criticalOnly`, `selectedActivityId`, `dateAnchor`) are independent, so the assertion at each switch is "all three values match what was set, not just the one most recently changed."

### 4.3 No new RLS / Supabase coverage

This phase is pure client state — no DB schema, no RPC, no realtime payload changes. No Supabase test fixtures touched.

---

## 5. Risks & open spots

- **Single render with empty `dateAnchor`.** Mitigated by `CalendarView`'s `dateAnchorIso || bootstrap.project.project_start` fallback. No flicker because the same value is computed both before and after hydration.
- **Two writers race on hydration.** Only `ScheduleApp` writes the initial value, and only if `dateAnchor === ""`. The effect's dependency array (`[dateAnchor, ...]`) re-runs but the condition guards re-writes. No race.
- **Future Gantt scroll-to-anchor.** Deliberately out of scope; flagged here so the next pass knows the hook point.
- **`LookaheadView` does not yet consume `dateAnchor` or `selectedActivityId` consistently.** Acknowledged; Phase 9 (Lookahead) will rework that view and address it there.

---

## 6. Acceptance checklist

- [ ] `ui-store` exposes `dateAnchor: string` and `setDateAnchor(iso)`.
- [ ] `ScheduleApp` seeds `dateAnchor` once from `project.project_start`.
- [ ] `CalendarView` reads from / writes to `ui-store.dateAnchor`; no local `anchor` state.
- [ ] `vitest` unit test covers the new store field/action.
- [ ] New `playwright` e2e test covers filter + selection + calendar anchor persistence across all view-switch permutations exercised in §4.2.
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` all pass.
