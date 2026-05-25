# Phase 8 — View Switcher State Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote `CalendarView`'s visible-month state into `ui-store` so filters, selection, and the calendar's anchored month all survive Gantt ↔ List ↔ Calendar switches.

**Architecture:** Add one ISO-date field (`dateAnchor`) and one action (`setDateAnchor`) to the existing Zustand `ui-store`. `ScheduleApp` lazily hydrates it from `bootstrap.project.project_start` on first mount. `CalendarView` swaps its local `useState` for the store-backed value. `GanttBar` already highlights the selected activity, so no Gantt changes. One Vitest unit test covers the store; one Playwright e2e test covers cross-view persistence.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Zustand 5, Vitest 4 (unit), Playwright 1.60 (e2e), Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-05-25-phase-8-view-switcher-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/state/ui-store.ts` | modify | Add `dateAnchor` field + `setDateAnchor` action. |
| `src/lib/state/ui-store.test.ts` | modify | Add unit test for the new field/action and confirm it survives a `setView` round-trip. |
| `src/components/schedule/Calendar/CalendarView.tsx` | modify | Export a `monthStartIso(iso: string): string` helper; replace local `anchor` state with `useUiStore` reads + writes. |
| `src/components/schedule/ScheduleApp.tsx` | modify | Add a one-shot hydration effect: when `dateAnchor === ""`, call `setDateAnchor(monthStartIso(bootstrap.project.project_start))`. |
| `tests/e2e/view-switcher-persistence.spec.ts` | create | Playwright spec covering filter + selection + calendar-month persistence across view switches. |

Each task is self-contained and ends with a commit.

---

## Conventions used in this codebase

- **Commit style:** Conventional Commits, scoped — `feat(state):`, `feat(ui):`, `test(e2e):`, `docs(phase-8):`, etc. See `git log --oneline -20`.
- **Co-author footer:** every commit ends with
  `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **Test commands:**
  - Unit (`vitest`): `npm test` (runs `vitest run --exclude 'tests/**'`)
  - E2E (`playwright`): `npm run test:e2e`
  - Static checks: `npm run lint`, `npm run typecheck`
- **Vitest store reset pattern (already in `ui-store.test.ts`):**
  `useUiStore.setState(useUiStore.getInitialState(), true)` inside `beforeEach`.
- **E2E login pattern (already in `scheduler-happy-path.spec.ts`):**
  Email `scheduler@ihs.test`, password `password123`, project name `Riverside Office Build`.

---

## Task 1 — Add `dateAnchor` to `ui-store` (TDD)

**Files:**
- Modify: `src/lib/state/ui-store.ts`
- Test: `src/lib/state/ui-store.test.ts`

- [ ] **Step 1: Add the failing unit test**

Open `src/lib/state/ui-store.test.ts` and append, before the closing `});` of the outer `describe`:

```ts
  it("starts with dateAnchor = '' and setDateAnchor updates it", () => {
    const s = useUiStore.getState();
    expect(s.dateAnchor).toBe("");
    s.setDateAnchor("2026-07-01");
    expect(useUiStore.getState().dateAnchor).toBe("2026-07-01");
  });

  it("setDateAnchor preserves selectedActivityId and filters across a view switch", () => {
    useUiStore.getState().select("act-1");
    useUiStore.getState().setFilter("criticalOnly", true);
    useUiStore.getState().setDateAnchor("2026-07-01");
    useUiStore.getState().setView("calendar");
    const s = useUiStore.getState();
    expect(s.view).toBe("calendar");
    expect(s.selectedActivityId).toBe("act-1");
    expect(s.filters.criticalOnly).toBe(true);
    expect(s.dateAnchor).toBe("2026-07-01");
  });
```

- [ ] **Step 2: Run the test and confirm it fails**

```
npm test -- src/lib/state/ui-store.test.ts
```

Expected: two failing assertions referencing `dateAnchor` / `setDateAnchor` (the type would normally make this a compile error in tests with strict TS; vitest is happy to fail at runtime with `expect(undefined).toBe("")` if the property is missing, but if you see a TS error first, that also counts as red — proceed to step 3 either way).

- [ ] **Step 3: Implement the store change**

Edit `src/lib/state/ui-store.ts`. Three small edits in this exact file:

(a) Add `dateAnchor` to the `UiState` interface (after `visibilityFilter`):

```ts
interface UiState {
  view: ScheduleView;
  mode: Mode;
  zoom: Zoom;
  selectedActivityId: string | null;
  editSessionId: string | null;
  filters: Filters;
  visibilityFilter: VisibilityFilter;
  dateAnchor: string; // ISO yyyy-mm-dd, "" until ScheduleApp hydrates
}
```

(b) Add `setDateAnchor` to `UiActions`:

```ts
interface UiActions {
  setView: (view: ScheduleView) => void;
  setZoom: (zoom: Zoom) => void;
  select: (id: string | null) => void;
  enterEditMode: () => void;
  exitEditMode: () => void;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  setVisibilityFilter: (v: VisibilityFilter) => void;
  setDateAnchor: (iso: string) => void;
}
```

(c) Add the field to `initialState` and the action to the `create()` body:

```ts
const initialState: UiState = {
  view: "gantt",
  mode: "view",
  zoom: "week",
  selectedActivityId: null,
  editSessionId: null,
  filters: { criticalOnly: false, trade: null, responsibleCompanyId: null },
  visibilityFilter: "all",
  dateAnchor: "",
};

export const useUiStore = create<UiState & UiActions>((set) => ({
  ...initialState,
  setView: (view) => set({ view }),
  setZoom: (zoom) => set({ zoom }),
  select: (id) => set({ selectedActivityId: id }),
  enterEditMode: () =>
    set({ mode: "edit", editSessionId: crypto.randomUUID() }),
  exitEditMode: () => set({ mode: "view", editSessionId: null }),
  setFilter: (key, value) =>
    set((s) => ({ filters: { ...s.filters, [key]: value } })),
  setVisibilityFilter: (v) => set({ visibilityFilter: v }),
  setDateAnchor: (iso) => set({ dateAnchor: iso }),
}));
```

- [ ] **Step 4: Run the test and confirm it passes**

```
npm test -- src/lib/state/ui-store.test.ts
```

Expected: all `useUiStore` tests pass, including the two new ones.

- [ ] **Step 5: Typecheck**

```
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```
git add src/lib/state/ui-store.ts src/lib/state/ui-store.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add dateAnchor + setDateAnchor to ui-store

Phase 8: shared month anchor so CalendarView's visible month
survives view switches. Initial value is empty string; ScheduleApp
will lazy-hydrate it from project.project_start.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Export `monthStartIso` helper from `CalendarView`

**Files:**
- Modify: `src/components/schedule/Calendar/CalendarView.tsx`

This helper is the bridge between an arbitrary ISO date (e.g. `project.project_start = "2026-04-15"`) and the month-start invariant of `dateAnchor` (`"2026-04-01"`). Both `ScheduleApp` (hydration) and `CalendarView` (rendering) need it.

- [ ] **Step 1: Add and export `monthStartIso`**

Open `src/components/schedule/Calendar/CalendarView.tsx`. Find the two existing helpers:

```ts
function startOfMonthUtc(iso: string): Date {
  const d = new Date(iso + "T00:00:00.000Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}
```

Add a third helper directly below them and export it:

```ts
export function monthStartIso(iso: string): string {
  return isoOf(startOfMonthUtc(iso));
}
```

Leave `startOfMonthUtc` and `isoOf` as module-private (no change to them).

- [ ] **Step 2: Typecheck**

```
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```
git add src/components/schedule/Calendar/CalendarView.tsx
git commit -m "$(cat <<'EOF'
feat(ui): export monthStartIso from CalendarView

Pure helper. Lets ScheduleApp normalize project.project_start to
its month-start before hydrating ui-store.dateAnchor.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — `ScheduleApp` hydrates `dateAnchor` on first mount

**Files:**
- Modify: `src/components/schedule/ScheduleApp.tsx`

- [ ] **Step 1: Add the import and hydration effect**

Open `src/components/schedule/ScheduleApp.tsx`.

(a) Add `monthStartIso` to the `CalendarView` import. The current line is:

```ts
import { CalendarView } from "./Calendar/CalendarView";
```

Change it to:

```ts
import { CalendarView, monthStartIso } from "./Calendar/CalendarView";
```

(b) Inside the `ScheduleApp` component body, after the existing `useUiStore` selectors (the lines that read `view` and `mode`) and before `const indexed = useMemo(...)`, add:

```ts
  const dateAnchor = useUiStore((s) => s.dateAnchor);
  const setDateAnchor = useUiStore((s) => s.setDateAnchor);

  useEffect(() => {
    if (dateAnchor === "") {
      setDateAnchor(monthStartIso(bootstrap.project.project_start));
    }
  }, [dateAnchor, setDateAnchor, bootstrap.project.project_start]);
```

The `useEffect` import already exists at the top of the file (already used for the `qc.setQueryData` effect), no import change needed.

- [ ] **Step 2: Typecheck**

```
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Lint**

```
npm run lint
```

Expected: no errors. (If `react-hooks/exhaustive-deps` complains about a missing dep, double-check the dependency array matches the snippet above exactly — those three deps are the complete set.)

- [ ] **Step 4: Commit**

```
git add src/components/schedule/ScheduleApp.tsx
git commit -m "$(cat <<'EOF'
feat(ui): hydrate ui-store.dateAnchor from project.project_start

Phase 8: ScheduleApp seeds the shared month anchor exactly once,
guarded by dateAnchor === "". Effect re-runs are no-ops after the
first write.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — `CalendarView` reads/writes the shared anchor

**Files:**
- Modify: `src/components/schedule/Calendar/CalendarView.tsx`

- [ ] **Step 1: Replace local `anchor` state with store reads + writes**

Open `src/components/schedule/Calendar/CalendarView.tsx`. The current top of the component body (after the `Props` interface and the helpers) is:

```ts
export function CalendarView({ bootstrap, indexed }: Props) {
  const [anchor, setAnchor] = useState(() => startOfMonthUtc(bootstrap.project.project_start));
  const select = useUiStore((s) => s.select);
  const selectedId = useUiStore((s) => s.selectedActivityId);
  const criticalOnly = useUiStore((s) => s.filters.criticalOnly);
```

Replace those four lines (the `useState` and three `useUiStore` selectors — keep them as a single block) with:

```ts
export function CalendarView({ bootstrap, indexed }: Props) {
  const dateAnchorIso = useUiStore((s) => s.dateAnchor);
  const setDateAnchor = useUiStore((s) => s.setDateAnchor);
  const select = useUiStore((s) => s.select);
  const selectedId = useUiStore((s) => s.selectedActivityId);
  const criticalOnly = useUiStore((s) => s.filters.criticalOnly);
  const anchor = startOfMonthUtc(dateAnchorIso || bootstrap.project.project_start);
```

`useState` is no longer needed; remove `useState` from the React import at the top of the file. The current import line is:

```ts
import { useMemo, useState } from "react";
```

Change it to:

```ts
import { useMemo } from "react";
```

- [ ] **Step 2: Route `move()` and the "Today" button through `setDateAnchor`**

Find the `move()` function:

```ts
  function move(months: number) {
    const next = new Date(anchor);
    next.setUTCMonth(next.getUTCMonth() + months);
    setAnchor(next);
  }
```

Replace it with:

```ts
  function move(months: number) {
    const next = new Date(anchor);
    next.setUTCMonth(next.getUTCMonth() + months);
    setDateAnchor(isoOf(next));
  }
```

Find the "Today" button's `onClick` (currently `() => setAnchor(startOfMonthUtc(bootstrap.project.project_start))`) and replace it with:

```ts
            onClick={() =>
              setDateAnchor(monthStartIso(bootstrap.project.project_start))
            }
```

(`monthStartIso` is already in scope — it was added in Task 2.)

- [ ] **Step 3: Add `data-testid` attributes the e2e test will rely on**

The calendar header currently looks like this:

```tsx
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <div className="text-sm font-medium">{monthLabel}</div>
        <div className="flex items-center gap-1">
          <button onClick={() => move(-1)} className="rounded p-1 hover:bg-slate-100">
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setDateAnchor(monthStartIso(bootstrap.project.project_start))}
            className="rounded px-2 py-1 text-xs hover:bg-slate-100"
          >
            Today
          </button>
          <button onClick={() => move(1)} className="rounded p-1 hover:bg-slate-100">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
```

Add four `data-testid` attributes so the e2e test can target the calendar header unambiguously (the same class name combinations exist elsewhere in the app — `data-testid` makes the selectors robust):

```tsx
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <div data-testid="calendar-month-label" className="text-sm font-medium">{monthLabel}</div>
        <div className="flex items-center gap-1">
          <button
            data-testid="calendar-prev-month"
            onClick={() => move(-1)}
            className="rounded p-1 hover:bg-slate-100"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            data-testid="calendar-today"
            onClick={() => setDateAnchor(monthStartIso(bootstrap.project.project_start))}
            className="rounded px-2 py-1 text-xs hover:bg-slate-100"
          >
            Today
          </button>
          <button
            data-testid="calendar-next-month"
            onClick={() => move(1)}
            className="rounded p-1 hover:bg-slate-100"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
```

- [ ] **Step 4: Typecheck**

```
npm run typecheck
```

Expected: no errors. If you see "Cannot find name 'setAnchor'" or "Cannot find name 'useState'", you missed an occurrence — search the file for the symbol.

- [ ] **Step 5: Run the existing unit tests**

```
npm test
```

Expected: full unit suite green, including the Task 1 store tests. (There are no direct unit tests for `CalendarView` — the e2e in Task 5 is the integration test.)

- [ ] **Step 6: Manually smoke-test in dev**

```
npm run dev
```

Open the app, sign in as `scheduler@ihs.test` / `password123`. From the Gantt view:

1. Click **Calendar**. Click `>` twice — the month label advances by two months.
2. Click **Gantt**. Click **Calendar** again. **Expected:** the label is still the advanced month (not the project-start month).
3. Click **Today**. **Expected:** the label snaps back to the project-start month.

Stop the dev server. (This step is not a gate — the Playwright test in Task 5 will codify it — but it's the fastest way to catch a wiring mistake.)

- [ ] **Step 7: Commit**

```
git add src/components/schedule/Calendar/CalendarView.tsx
git commit -m "$(cat <<'EOF'
feat(ui): CalendarView reads visible month from ui-store.dateAnchor

Removes the local useState that reset on every remount, so flipping
to another view and back preserves the calendar's anchored month.
move() and Today both write through setDateAnchor.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Playwright e2e: cross-view persistence

**Files:**
- Create: `tests/e2e/view-switcher-persistence.spec.ts`

- [ ] **Step 1: Create the test file**

Write the file `tests/e2e/view-switcher-persistence.spec.ts` with this content:

```ts
import { test, expect } from "@playwright/test";

test("filter, selection, and calendar month survive view switches", async ({ page }) => {
  // Sign in.
  await page.goto("/login");
  await page.getByLabel("Email").fill("scheduler@ihs.test");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Riverside Office Build")).toBeVisible({ timeout: 10_000 });

  // Toggle Critical Path ON.
  await page.getByRole("button", { name: /Critical path/ }).click();
  await expect(
    page.getByRole("button", { name: /Critical path/, pressed: true }),
  ).toBeVisible();

  // Switch to List and select the first visible (critical) row.
  await page.getByRole("button", { name: "List" }).click();
  const firstRow = page.locator("tbody tr").first();
  await firstRow.click();
  await expect(firstRow).toHaveClass(/bg-sky-50/);
  const selectedName = (await firstRow.locator("td").first().textContent())?.trim() ?? "";
  expect(selectedName.length).toBeGreaterThan(0);

  // Switch to Calendar; capture the initial month label, advance two months.
  await page.getByRole("button", { name: "Calendar" }).click();
  const monthLabel = page.getByTestId("calendar-month-label");
  await expect(monthLabel).toBeVisible();
  const initialMonth = (await monthLabel.textContent())?.trim() ?? "";
  expect(initialMonth.length).toBeGreaterThan(0);

  const nextMonthBtn = page.getByTestId("calendar-next-month");
  await nextMonthBtn.click();
  await nextMonthBtn.click();

  const advancedMonth = (await monthLabel.textContent())?.trim() ?? "";
  expect(advancedMonth).not.toBe(initialMonth);

  // Switch to Gantt and back; verify Critical Path is still on.
  await page.getByRole("button", { name: "Gantt" }).click();
  await expect(
    page.getByRole("button", { name: /Critical path/, pressed: true }),
  ).toBeVisible();

  // Back to Calendar — assert the month label is still the advanced month.
  await page.getByRole("button", { name: "Calendar" }).click();
  await expect(monthLabel).toHaveText(advancedMonth);

  // Back to List — assert the same row is still highlighted.
  await page.getByRole("button", { name: "List" }).click();
  const rowAfter = page.locator("tbody tr").first();
  await expect(rowAfter).toHaveClass(/bg-sky-50/);
  await expect(rowAfter.locator("td").first()).toHaveText(selectedName);
});
```

Notes on the locator choices:
- `getByTestId("calendar-month-label")` and `getByTestId("calendar-next-month")` rely on the `data-testid` attributes added in Task 4 Step 3.
- `bg-sky-50` is the highlight class used by `ListView` (`ListView.tsx:80`). If the styling is ever generalized, switch to a `data-selected="true"` attribute on the row — but the class assertion is the lightest-weight thing that works today.

- [ ] **Step 2: Run the new e2e test**

```
npm run test:e2e -- tests/e2e/view-switcher-persistence.spec.ts
```

Expected: PASS. If a locator fails, inspect the actual HTML via `npx playwright test tests/e2e/view-switcher-persistence.spec.ts --headed --debug` and adjust the selector. With `data-testid` selectors the most likely failure mode is forgetting to commit Task 4 Step 3 — confirm the testids are present in the running app's HTML.

- [ ] **Step 3: Run the entire e2e suite to confirm no regressions**

```
npm run test:e2e
```

Expected: all tests pass. If `scheduler-happy-path.spec.ts` now flakes because it shares the same session/cookies, run with `--workers=1`:

```
npm run test:e2e -- --workers=1
```

- [ ] **Step 4: Commit**

```
git add tests/e2e/view-switcher-persistence.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): view switcher preserves filter, selection, and calendar month

Phase 8 acceptance: Gantt -> List (select) -> Calendar (advance two
months) -> Gantt -> Calendar -> List asserts all three pieces of UI
state are preserved end-to-end.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Final verification & wrap-up

**Files:** none modified; this is a verification gate.

- [ ] **Step 1: Run the full check pipeline**

```
npm run lint && npm run typecheck && npm test && npm run test:e2e
```

Expected: every command exits 0. Any failure here means a prior task was incomplete — fix the underlying issue rather than the symptom (do not skip a hook or weaken an assertion).

- [ ] **Step 2: Confirm spec acceptance checklist is now satisfied**

Re-open `docs/superpowers/specs/2026-05-25-phase-8-view-switcher-design.md`. Check that every item in §6 is now true:

- `ui-store` exposes `dateAnchor: string` and `setDateAnchor(iso)` — Task 1.
- `ScheduleApp` seeds `dateAnchor` once from `project.project_start` — Task 3.
- `CalendarView` reads from / writes to `ui-store.dateAnchor`; no local `anchor` state — Task 4.
- `vitest` unit test covers the new store field/action — Task 1.
- New `playwright` e2e test covers filter + selection + calendar anchor persistence — Task 5.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` all pass — Step 1 above.

No code change in this task. If anything is missing, return to the relevant task instead of committing.

- [ ] **Step 3: Verify the branch is clean and ready for PR**

```
git status
git log --oneline main..HEAD
```

Expected: working tree clean. The `git log` should show five new commits (Tasks 1–5), all with the Co-Authored-By footer.

No commit in this task.

---

## Out-of-scope reminders (do NOT do these in this plan)

- Do not add multi-day spanning bars to `CalendarView`.
- Do not add a `+N more` expander/popover.
- Do not add toolbar-level Today/zoom controls.
- Do not surface `filters.trade` or `filters.responsibleCompanyId` in the toolbar.
- Do not wire `GanttChart` to scroll to `dateAnchor` — Gantt is intentionally not anchor-driven in this phase.
- Do not touch `LookaheadView` — Phase 9 will rework that view.
