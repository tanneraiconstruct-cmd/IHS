# Phase 7 — Comments Side Panel & Visibility, Field-Ready v1 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the comments side panel field-usable. Show *who* posted what, group an Edit Mode session's history rows under one collapsible header with an optional saved note, filter by visibility, let authors fix or soft-delete their own comments, and propagate session notes live via realtime. No new tables or columns; one new RLS policy.

**Architecture:** Bootstrap gains a `users` lookup so the panel and `PresenceBar` share one source of author display data. Three new mutation hooks (`useUpdateComment`, `useSoftDeleteComment`, `useSetSessionNote`) follow the existing `usePostComment` pattern — direct supabase-js writes under RLS, optimistic cache patch, toast on error. Two new components (`EditSessionGroup`, `CommentItem`) and one modal (`SessionNoteModal`) reshape the feed render and the Edit Mode exit flow. One reducer case + event-union variant carries `activity_history` UPDATEs through the realtime channel.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, `@supabase/supabase-js`, `@tanstack/react-query`, `zustand`, Tailwind v4, Vitest + React Testing Library + `jsdom`, Playwright.

**Source spec:** `docs/superpowers/specs/2026-05-24-phase-7-comments-design.md`

---

## Conventions & Working Notes

- **Branch:** all work happens on `feat/phase-7-comments` (created in Task 1 from `origin/main`).
- **TDD:** every non-trivial code task starts with a failing test. The plan shows the test code; do not skip to implementation. For pure logic the test is Vitest with `node` env; for React components it's Vitest with `jsdom`. The Vitest config already routes `.test.tsx` to `jsdom`.
- **Frequent commits:** every task ends with a commit step. Don't batch commits across tasks. If a task balloons mid-implementation, split it.
- **The function is `insertHistoryRows`** in `src/lib/state/mutations.ts:79`, not `appendHistoryRows` as the spec colloquially named it. Code in this plan uses the real name.
- **Realtime echo for new mutations.** `useUpdateComment` / `useSoftDeleteComment` / `useSetSessionNote` must call `markInflight(id)` for every row they touch, so the UPDATE event echoed back doesn't cause a no-op or visible flicker.
- **Toast on error.** Use `toast.error("…")` from `@/lib/state/toasts` — same pattern as `usePostComment` (`mutations.ts:417`).
- **Hardcoded test users / project** (same as Phase 6):
  - Project ID: `70000000-0000-0000-0000-000000000000` (seeded Riverside Office Build).
  - Test users (password `password123`):
    - `scheduler@ihs.test` — internal scheduler, full edit access.
    - `pm@ihs.test` — internal project manager (used as the second observer in E2E).
    - `tp-viewer@trade.test` — external trade-partner viewer, read-only.
- **Users table reality.** The `users` table uses `full_name`, not `display_name`. The spec's `display_name` field is mapped from `full_name` at the bootstrap layer.
- **References to read before starting:**
  - `docs/superpowers/specs/2026-05-24-phase-7-comments-design.md` — the spec this plan implements.
  - `src/lib/state/mutations.ts` lines 79–103 (`insertHistoryRows`), 264 (good-pattern call site reading project default), 311/345/385 (three call sites that hardcode `"shared"` and need to be fixed).
  - `src/components/schedule/SidePanel/SidePanel.tsx` — the existing feed render the new components replace.
  - `src/components/schedule/EditModeBanner.tsx` — the 27-line file that grows a modal-host responsibility in Task 17.
  - `src/lib/realtime/reducers.ts` lines 143–150 — the current `reduceHistory` that this plan extends with UPDATE.
  - `src/lib/realtime/presence.ts` — exports `deriveColor(userId)`, which the bootstrap reuses to pre-compute author colors.
  - `tests/e2e/scheduler-happy-path.spec.ts` — Playwright login + interaction pattern.
  - `tests/e2e/external-user.spec.ts` — the existing internal-comment-hidden assertion this plan extends.

---

## File Structure

### To create

| File | Responsibility |
|---|---|
| `supabase/migrations/20260525000000_phase7_history_update_policy.sql` | Adds `activity_history_update` RLS policy (`changed_by = auth.uid()`). |
| `src/components/schedule/SidePanel/EditSessionGroup.tsx` | Collapsible grouped-history card. |
| `src/components/schedule/SidePanel/EditSessionGroup.test.tsx` | Component tests. |
| `src/components/schedule/SidePanel/CommentItem.tsx` | Single-comment renderer with own-comment edit + soft-delete. |
| `src/components/schedule/SidePanel/CommentItem.test.tsx` | Component tests. |
| `src/components/schedule/SessionNoteModal.tsx` | Modal opened from EditModeBanner on Done click. |
| `src/components/schedule/SessionNoteModal.test.tsx` | Component tests. |
| `src/lib/state/mutations.update-comment.test.ts` | Mutation hook test. |
| `src/lib/state/mutations.soft-delete-comment.test.ts` | Mutation hook test. |
| `src/lib/state/mutations.set-session-note.test.ts` | Mutation hook test. |

### To modify

| File | Change |
|---|---|
| `src/lib/schedule/types.ts` | Add `UserLookupEntry` interface; add `users: Record<string, UserLookupEntry>` to `BootstrapData`. |
| `src/lib/schedule/bootstrap.ts` | Fetch `users` in parallel; build map with `deriveColor`; return as `users`. |
| `src/lib/state/ui-store.ts` | Add `visibilityFilter: "all" \| "internal" \| "shared"` + `setVisibilityFilter`. |
| `src/lib/state/mutations.ts` | Three new hooks; fix three call sites that hardcode `"shared"` to read project default. |
| `src/lib/realtime/events.ts` | Add `{ table: "activity_history"; type: "UPDATE"; new: DbActivityHistory }` variant. |
| `src/lib/realtime/normalize.ts` | Allow `activity_history` UPDATE through (currently DELETE has an early-return; INSERT/UPDATE share the generic branch — verify, no code change expected here, but keep this file in scope for the audit). |
| `src/lib/realtime/reducers.ts` | Extend `reduceHistory` to handle `UPDATE`. |
| `src/lib/realtime/reducers.test.ts` | Add UPDATE-by-id test + UPDATE-unknown-id no-op test. |
| `src/components/schedule/SidePanel/SidePanel.tsx` | Visibility filter chips; group history into `<EditSessionGroup>`; render `<CommentItem>`; pass `defaultVisibility` to `CommentComposer`. |
| `src/components/schedule/SidePanel/CommentComposer.tsx` | Accept `defaultVisibility` prop, use as initial state. |
| `src/components/schedule/EditModeBanner.tsx` | Done click opens `SessionNoteModal` if the session produced history rows, otherwise calls `exitEditMode` directly. |
| `tests/e2e/scheduler-happy-path.spec.ts` | Add session-note + edit-comment + soft-delete-comment flow. |
| `tests/e2e/external-user.spec.ts` | Assert visibility-filter does not include an `internal` option. |

### Unchanged

- All Phase 1 engine.
- All Phase 2 schema except the one new RLS policy.
- All Phase 3 server pipeline (still dormant).
- All Phase 4 components outside `SidePanel/`, `EditModeBanner`, and the new `SessionNoteModal`.
- All Phase 5 inline-edit cells.
- All Phase 6 channel mounting + presence; only events/normalize/reducers touched.

---

## Task 1: Branch + plumbing baseline

**Files:** none (verification only).

- [ ] **Step 1: Verify clean tree on main**

```bash
cd "/Users/tanner/IHS- Scheduling Tool"
git fetch origin
git status
```

Expected: clean working tree (or only `.superpowers/` untracked, which is fine). If `docs/phase-7-design` is still checked out from the spec commit, that's where you are; the new feature branch will fork from `origin/main` below.

- [ ] **Step 2: Create the working branch from origin/main**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b feat/phase-7-comments
```

- [ ] **Step 3: Verify baseline build + tests pass**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: typecheck clean, lint clean, Vitest reports all tests passing. Record the baseline test count — every subsequent task must keep or grow it.

- [ ] **Step 4: Confirm Supabase local stack is up**

```bash
npx supabase status
```

Expected: all services up. If anything is down, `npx supabase start`.

- [ ] **Step 5: Cherry-pick or rebase in the spec commit if needed**

The spec was committed on `docs/phase-7-design`. If you want it on this branch's history (recommended), cherry-pick it:

```bash
git log --oneline -1 docs/phase-7-design -- docs/superpowers/specs/2026-05-24-phase-7-comments-design.md
git cherry-pick <hash>
```

Otherwise leave it on the docs branch — both will end up in main after the PR merges.

---

## Task 2: Migration — `activity_history_update` RLS policy

**Files:**
- Create: `supabase/migrations/20260525000000_phase7_history_update_policy.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Phase 7: allow the original author to UPDATE their activity_history rows.
-- Used to backfill session_note on Done-Save. RLS otherwise denies UPDATE
-- by default (only SELECT/INSERT policies exist on activity_history).

create policy activity_history_update on activity_history for update to authenticated
  using (changed_by = auth.uid())
  with check (changed_by = auth.uid());
```

- [ ] **Step 2: Apply the migration locally**

```bash
npx supabase db reset
```

Expected: reset completes; all migrations re-apply with no errors. If the reset wipes seeded test data, run the seed step (whatever the existing `npm run seed` or `supabase/seed.sql` flow is — same as Phase 6).

- [ ] **Step 3: Verify the policy with psql**

```bash
psql "$(npx supabase status -o json | jq -r '.DB_URL')" -c "select polname from pg_policies where tablename = 'activity_history';"
```

Expected output includes `activity_history_update` alongside the existing `activity_history_select` and `activity_history_insert`.

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: still green (no test depends on UPDATE being denied).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525000000_phase7_history_update_policy.sql
git commit -m "feat(db): add activity_history_update RLS policy (author-only)"
```

---

## Task 3: Types — `UserLookupEntry` + `BootstrapData.users`

**Files:**
- Modify: `src/lib/schedule/types.ts`

- [ ] **Step 1: Add `UserLookupEntry` and extend `BootstrapData`**

Append to `src/lib/schedule/types.ts` (after the existing `DbProject` declaration; place `UserLookupEntry` immediately before `BootstrapData`):

```ts
export interface UserLookupEntry {
  id: string;
  display_name: string;   // mapped from users.full_name in bootstrap
  company_id: string;
  color: string;          // hex from deriveColor(id); pre-computed
}
```

Add to the `BootstrapData` interface body (alongside the other arrays):

```ts
  users: Record<string, UserLookupEntry>;
```

- [ ] **Step 2: Run typecheck — expect cascading failures**

```bash
npm run typecheck
```

Expected: a handful of test fixtures / call sites that construct `BootstrapData` literals will now error with "Property 'users' is missing." These are addressed in Tasks 4 and onward — for this commit we just lock in the type shape. To unblock the immediate compile, optionally make `users` optional with `users?: Record<string, UserLookupEntry>;` for *this commit only* and tighten in Task 4 once the producer + a fixture helper exist.

**Decision:** keep it required. Task 4 lands the producer and a test-fixture helper in the same commit, which will satisfy every call site. Leave the type required and move on — the next task fixes everything in one go.

- [ ] **Step 3: Commit**

```bash
git add src/lib/schedule/types.ts
git commit -m "feat(types): add UserLookupEntry + users lookup to BootstrapData"
```

(Do **not** push or run typecheck-gating CI here — Task 4 restores green.)

---

## Task 4: Bootstrap — fetch + build the `users` lookup

**Files:**
- Modify: `src/lib/schedule/bootstrap.ts`
- Create: `src/lib/schedule/bootstrap.users.test.ts`

- [ ] **Step 1: Write the failing test for the lookup-build helper**

Create `src/lib/schedule/bootstrap.users.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildUserLookup } from "./bootstrap";

describe("buildUserLookup", () => {
  it("maps full_name to display_name and pre-computes color", () => {
    const rows = [
      { id: "u1", company_id: "c1", full_name: "Tanner Frenkel" },
      { id: "u2", company_id: "c2", full_name: "Sub Sam" },
    ];
    const lookup = buildUserLookup(rows);
    expect(lookup.u1.display_name).toBe("Tanner Frenkel");
    expect(lookup.u2.display_name).toBe("Sub Sam");
    expect(lookup.u1.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(lookup.u1.color).toBe(lookup.u1.color); // deterministic
  });

  it("returns an empty record when no rows", () => {
    expect(buildUserLookup([])).toEqual({});
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/lib/schedule/bootstrap.users.test.ts
```

Expected: FAIL with "buildUserLookup is not a function" (or import error).

- [ ] **Step 3: Implement `buildUserLookup` + wire the fetch**

Modify `src/lib/schedule/bootstrap.ts`. Add the import at the top:

```ts
import { deriveColor } from "@/lib/realtime/presence";
```

Add the export (place it above `fetchBootstrap`):

```ts
interface UserRow {
  id: string;
  company_id: string;
  full_name: string;
}

export function buildUserLookup(rows: UserRow[]): Record<string, import("./types").UserLookupEntry> {
  const out: Record<string, import("./types").UserLookupEntry> = {};
  for (const r of rows) {
    out[r.id] = {
      id: r.id,
      display_name: r.full_name,
      company_id: r.company_id,
      color: deriveColor(r.id),
    };
  }
  return out;
}
```

Inside `fetchBootstrap`, add a `usersRes` to the `Promise.all` (place it at the end of the array, after `lookaheadTasksRes`):

```ts
    supabase.from("users").select("id, company_id, full_name"),
```

Then update the destructuring at line 27–38 to include `usersRes` as the last item, and add `usersRes` to the error-check loop. Finally, append `users: buildUserLookup((usersRes.data ?? []) as unknown as UserRow[])` to the returned object at line 119–131.

- [ ] **Step 4: Run the helper test**

```bash
npx vitest run src/lib/schedule/bootstrap.users.test.ts
```

Expected: PASS.

- [ ] **Step 5: Fix any test-fixture compile errors**

```bash
npm run typecheck
```

Find every location that constructs a `BootstrapData` literal and is now missing `users:`. Common spots:
- `tests/integration/setup.ts` (look for `as BootstrapData` or `: BootstrapData`).
- `src/lib/realtime/reducers.test.ts` (fixture builders).
- `src/lib/state/mutations.test.ts` if it builds fixtures directly.

For each, add `users: {}`. (Test fixtures that don't exercise author rendering don't need real entries.)

- [ ] **Step 6: Run the full suite + lint**

```bash
npm test && npm run typecheck && npm run lint
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/schedule/bootstrap.ts src/lib/schedule/bootstrap.users.test.ts \
        tests/integration/setup.ts src/lib/realtime/reducers.test.ts src/lib/state/mutations.test.ts
# (omit any of the above that didn't need changes)
git commit -m "feat(bootstrap): fetch users + build display-name/color lookup"
```

---

## Task 5: UI store — `visibilityFilter`

**Files:**
- Modify: `src/lib/state/ui-store.ts`
- Modify: `src/lib/state/ui-store.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `src/lib/state/ui-store.test.ts` inside the existing describe block (mirror the existing assertion style):

```ts
  it("starts with visibilityFilter = 'all' and setVisibilityFilter updates it", () => {
    const s = useUiStore.getState();
    expect(s.visibilityFilter).toBe("all");
    s.setVisibilityFilter("internal");
    expect(useUiStore.getState().visibilityFilter).toBe("internal");
    s.setVisibilityFilter("shared");
    expect(useUiStore.getState().visibilityFilter).toBe("shared");
  });
```

- [ ] **Step 2: Run it — fail**

```bash
npx vitest run src/lib/state/ui-store.test.ts
```

Expected: TypeScript / runtime error — `visibilityFilter` / `setVisibilityFilter` do not exist.

- [ ] **Step 3: Implement**

In `src/lib/state/ui-store.ts`:

1. Add a type alias near the top:
```ts
export type VisibilityFilter = "all" | "internal" | "shared";
```

2. Add to `UiState`:
```ts
  visibilityFilter: VisibilityFilter;
```

3. Add to `UiActions`:
```ts
  setVisibilityFilter: (v: VisibilityFilter) => void;
```

4. Add to `initialState`:
```ts
  visibilityFilter: "all",
```

5. Add to the store factory's actions block:
```ts
  setVisibilityFilter: (v) => set({ visibilityFilter: v }),
```

- [ ] **Step 4: Run all ui-store tests**

```bash
npx vitest run src/lib/state/ui-store.test.ts
```

Expected: PASS — including the new case + the existing reset-to-initialState case.

- [ ] **Step 5: Commit**

```bash
git add src/lib/state/ui-store.ts src/lib/state/ui-store.test.ts
git commit -m "feat(state): add visibilityFilter to ui-store"
```

---

## Task 6: Mutation — `useUpdateComment`

**Files:**
- Create: `src/lib/state/mutations.update-comment.test.ts`
- Modify: `src/lib/state/mutations.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/state/mutations.update-comment.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useUpdateComment } from "./mutations";
import type { BootstrapData, DbComment } from "@/lib/schedule/types";

const PROJECT_ID = "70000000-0000-0000-0000-000000000000";
const USER_ID = "u-self";

const sampleComment: DbComment = {
  id: "c1",
  project_id: PROJECT_ID,
  author_user_id: USER_ID,
  body: "old body",
  parent_comment_id: null,
  scope: "project",
  target_activity_id: null,
  visibility: "shared",
  created_at: "2026-05-24T12:00:00Z",
  edited_at: null,
  deleted_at: null,
};

function makeBootstrap(): BootstrapData {
  return {
    project: { id: PROJECT_ID, name: "p", number: "1", project_start: "2026-01-01",
               data_date: "2026-01-01", default_calendar_id: "cal", critical_float_threshold: 0,
               comment_visibility_default: "internal" },
    calendars: [], calendarExceptions: [], wbsNodes: [], activities: [],
    dependencies: [], constraints: [],
    comments: [sampleComment],
    history: [], lookaheads: [], lookaheadTasks: [], users: {},
  } as unknown as BootstrapData;
}

const updateChain = {
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  single: vi.fn(),
};
const fromMock = vi.fn(() => updateChain);
const authMock = { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) };

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ from: fromMock, auth: authMock }),
}));

const toastMock = { error: vi.fn(), warn: vi.fn() };
vi.mock("./toasts", () => ({ toast: toastMock }));

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useUpdateComment", () => {
  it("optimistically patches body + edited_at, then keeps it on success", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["schedule", PROJECT_ID], makeBootstrap());
    const updatedRow = { ...sampleComment, body: "new body", edited_at: "2026-05-24T12:30:00Z" };
    updateChain.single.mockResolvedValueOnce({ data: updatedRow, error: null });

    const { result } = renderHook(() => useUpdateComment(PROJECT_ID), { wrapper: wrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync({ commentId: "c1", body: "new body" });
    });

    const cached = qc.getQueryData<BootstrapData>(["schedule", PROJECT_ID]);
    expect(cached?.comments[0].body).toBe("new body");
    expect(cached?.comments[0].edited_at).toBe("2026-05-24T12:30:00Z");
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("rolls back + toasts on error", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["schedule", PROJECT_ID], makeBootstrap());
    updateChain.single.mockResolvedValueOnce({ data: null, error: { message: "rls denied" } });

    const { result } = renderHook(() => useUpdateComment(PROJECT_ID), { wrapper: wrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync({ commentId: "c1", body: "doomed" });
    });

    const cached = qc.getQueryData<BootstrapData>(["schedule", PROJECT_ID]);
    expect(cached?.comments[0].body).toBe("old body");        // rolled back
    expect(cached?.comments[0].edited_at).toBeNull();
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("rls denied"));
  });
});
```

- [ ] **Step 2: Run it — fail**

```bash
npx vitest run src/lib/state/mutations.update-comment.test.ts
```

Expected: FAIL — `useUpdateComment` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/state/mutations.ts` (after `usePostComment`):

```ts
export function useUpdateComment(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["updateComment", projectId],
    mutationFn: async (vars: { commentId: string; body: string }) => {
      const sb = createSupabaseBrowserClient();
      const data = qc.getQueryData<BootstrapData>(["schedule", projectId]);
      const prev = data?.comments.find((c) => c.id === vars.commentId);
      if (!data || !prev) {
        toast.error("Comment not in cache");
        return;
      }

      // Optimistic patch.
      const optimisticEditedAt = new Date().toISOString();
      qc.setQueryData(["schedule", projectId], (cur: BootstrapData | undefined) => {
        if (!cur) return cur;
        return {
          ...cur,
          comments: cur.comments.map((c) =>
            c.id === vars.commentId ? { ...c, body: vars.body, edited_at: optimisticEditedAt } : c),
        };
      });

      const { data: updated, error } = await sb
        .from("comments")
        .update({ body: vars.body, edited_at: new Date().toISOString() })
        .eq("id", vars.commentId)
        .select("id, project_id, author_user_id, body, parent_comment_id, scope, target_activity_id, visibility, created_at, edited_at, deleted_at")
        .single();

      if (error || !updated) {
        // Rollback.
        qc.setQueryData(["schedule", projectId], (cur: BootstrapData | undefined) => {
          if (!cur) return cur;
          return {
            ...cur,
            comments: cur.comments.map((c) => c.id === vars.commentId ? prev : c),
          };
        });
        toast.error(`Comment edit failed: ${error?.message ?? "unknown"}`);
        return;
      }

      // Replace with authoritative row + mark echo.
      qc.setQueryData(["schedule", projectId], (cur: BootstrapData | undefined) => {
        if (!cur) return cur;
        return {
          ...cur,
          comments: cur.comments.map((c) => c.id === vars.commentId ? (updated as unknown as typeof c) : c),
        };
      });
      markInflight(updated.id);
    },
  });
}
```

- [ ] **Step 4: Run the new test**

```bash
npx vitest run src/lib/state/mutations.update-comment.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/state/mutations.ts src/lib/state/mutations.update-comment.test.ts
git commit -m "feat(mutations): add useUpdateComment with optimistic body+edited_at"
```

---

## Task 7: Mutation — `useSoftDeleteComment`

**Files:**
- Create: `src/lib/state/mutations.soft-delete-comment.test.ts`
- Modify: `src/lib/state/mutations.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/state/mutations.soft-delete-comment.test.ts`. Copy the same harness (mocks for `from`, `auth`, `toast`, `wrapper(qc)`, `makeBootstrap()`) from Task 6 verbatim — these helpers will eventually live in a shared file, but for now duplication keeps each test self-contained. Then:

```ts
describe("useSoftDeleteComment", () => {
  it("optimistically sets deleted_at, keeps it on success", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["schedule", PROJECT_ID], makeBootstrap());
    const deletedRow = { ...sampleComment, deleted_at: "2026-05-24T12:45:00Z" };
    updateChain.single.mockResolvedValueOnce({ data: deletedRow, error: null });

    const { result } = renderHook(() => useSoftDeleteComment(PROJECT_ID), { wrapper: wrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync({ commentId: "c1" });
    });

    const cached = qc.getQueryData<BootstrapData>(["schedule", PROJECT_ID]);
    expect(cached?.comments[0].deleted_at).toBe("2026-05-24T12:45:00Z");
  });

  it("rolls back on error", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["schedule", PROJECT_ID], makeBootstrap());
    updateChain.single.mockResolvedValueOnce({ data: null, error: { message: "rls denied" } });

    const { result } = renderHook(() => useSoftDeleteComment(PROJECT_ID), { wrapper: wrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync({ commentId: "c1" });
    });

    expect(qc.getQueryData<BootstrapData>(["schedule", PROJECT_ID])?.comments[0].deleted_at).toBeNull();
    expect(toastMock.error).toHaveBeenCalled();
  });
});
```

Add `useSoftDeleteComment` to the import list at the top of the file.

- [ ] **Step 2: Run — fail**

```bash
npx vitest run src/lib/state/mutations.soft-delete-comment.test.ts
```

Expected: FAIL — hook not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/state/mutations.ts`:

```ts
export function useSoftDeleteComment(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["softDeleteComment", projectId],
    mutationFn: async (vars: { commentId: string }) => {
      const sb = createSupabaseBrowserClient();
      const data = qc.getQueryData<BootstrapData>(["schedule", projectId]);
      const prev = data?.comments.find((c) => c.id === vars.commentId);
      if (!data || !prev) {
        toast.error("Comment not in cache");
        return;
      }

      const optimisticDeletedAt = new Date().toISOString();
      qc.setQueryData(["schedule", projectId], (cur: BootstrapData | undefined) => {
        if (!cur) return cur;
        return {
          ...cur,
          comments: cur.comments.map((c) =>
            c.id === vars.commentId ? { ...c, deleted_at: optimisticDeletedAt } : c),
        };
      });

      const { data: updated, error } = await sb
        .from("comments")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", vars.commentId)
        .select("id, project_id, author_user_id, body, parent_comment_id, scope, target_activity_id, visibility, created_at, edited_at, deleted_at")
        .single();

      if (error || !updated) {
        qc.setQueryData(["schedule", projectId], (cur: BootstrapData | undefined) => {
          if (!cur) return cur;
          return { ...cur, comments: cur.comments.map((c) => c.id === vars.commentId ? prev : c) };
        });
        toast.error(`Comment delete failed: ${error?.message ?? "unknown"}`);
        return;
      }

      qc.setQueryData(["schedule", projectId], (cur: BootstrapData | undefined) => {
        if (!cur) return cur;
        return {
          ...cur,
          comments: cur.comments.map((c) => c.id === vars.commentId ? (updated as unknown as typeof c) : c),
        };
      });
      markInflight(updated.id);
    },
  });
}
```

- [ ] **Step 4: Run test**

```bash
npx vitest run src/lib/state/mutations.soft-delete-comment.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/state/mutations.ts src/lib/state/mutations.soft-delete-comment.test.ts
git commit -m "feat(mutations): add useSoftDeleteComment with rollback"
```

---

## Task 8: Mutation — `useSetSessionNote`

**Files:**
- Create: `src/lib/state/mutations.set-session-note.test.ts`
- Modify: `src/lib/state/mutations.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/state/mutations.set-session-note.test.ts`. Reuse the same harness style. Test fixture: a bootstrap with three history rows sharing one `edit_session_id`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSetSessionNote } from "./mutations";
import type { BootstrapData, DbActivityHistory } from "@/lib/schedule/types";

const PROJECT_ID = "70000000-0000-0000-0000-000000000000";
const USER_ID = "u-self";
const SESSION_ID = "session-123";

function row(id: string): DbActivityHistory {
  return {
    id, project_id: PROJECT_ID, edit_session_id: SESSION_ID,
    entity_type: "activity", entity_id: "a1", field: "name",
    old_value: "old", new_value: "new",
    changed_by: USER_ID, changed_at: "2026-05-24T12:00:00Z",
    visibility: "internal", session_note: null,
  } as DbActivityHistory;
}

function makeBootstrap(): BootstrapData {
  return {
    project: { id: PROJECT_ID, name: "p", number: "1", project_start: "2026-01-01",
               data_date: "2026-01-01", default_calendar_id: "cal", critical_float_threshold: 0,
               comment_visibility_default: "internal" },
    calendars: [], calendarExceptions: [], wbsNodes: [], activities: [],
    dependencies: [], constraints: [], comments: [],
    history: [row("h1"), row("h2"), row("h3")],
    lookaheads: [], lookaheadTasks: [], users: {},
  } as unknown as BootstrapData;
}

const updateChain = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
// terminal: returns the awaited result for `.eq(...).eq(...)` (the chain ends without .single())
(updateChain.eq as ReturnType<typeof vi.fn>).mockImplementation(function (this: typeof updateChain) {
  return Object.assign(this, { then: undefined });
});

// We're going to await `sb.from("activity_history").update(...).eq(...).eq(...)`. Easiest:
// use a thenable on the second .eq() call by reassigning at the test level.

const fromMock = vi.fn(() => updateChain);
const authMock = { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) };

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ from: fromMock, auth: authMock }),
}));

const toastMock = { error: vi.fn(), warn: vi.fn() };
vi.mock("./toasts", () => ({ toast: toastMock }));

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => { vi.clearAllMocks(); });

describe("useSetSessionNote", () => {
  it("patches session_note on every row of the session in cache", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["schedule", PROJECT_ID], makeBootstrap());

    // Build a chain that resolves to no-error.
    const terminal = { error: null };
    fromMock.mockReturnValueOnce({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve(terminal)),
        })),
      })),
    } as unknown as ReturnType<typeof updateChain.update>);

    const { result } = renderHook(() => useSetSessionNote(PROJECT_ID), { wrapper: wrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync({ editSessionId: SESSION_ID, note: "re-sequenced concrete" });
    });

    const cached = qc.getQueryData<BootstrapData>(["schedule", PROJECT_ID]);
    expect(cached?.history.every((h) => h.session_note === "re-sequenced concrete")).toBe(true);
  });

  it("rolls back all rows on error", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["schedule", PROJECT_ID], makeBootstrap());

    fromMock.mockReturnValueOnce({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ error: { message: "denied" } })),
        })),
      })),
    } as unknown as ReturnType<typeof updateChain.update>);

    const { result } = renderHook(() => useSetSessionNote(PROJECT_ID), { wrapper: wrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync({ editSessionId: SESSION_ID, note: "ouch" });
    });

    const cached = qc.getQueryData<BootstrapData>(["schedule", PROJECT_ID]);
    expect(cached?.history.every((h) => h.session_note === null)).toBe(true);
    expect(toastMock.error).toHaveBeenCalled();
  });
});
```

(The thenable-on-second-`.eq()` pattern matches how the production code chains `.update().eq("edit_session_id", ...).eq("changed_by", ...)`. If `@supabase/supabase-js` quirks make this awkward, switch to `vi.fn().mockResolvedValue({ error: null })` with a single `.eq()` chain — the production code can be `.match({...})` instead.)

- [ ] **Step 2: Run — fail**

```bash
npx vitest run src/lib/state/mutations.set-session-note.test.ts
```

Expected: FAIL — `useSetSessionNote` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/state/mutations.ts`:

```ts
export function useSetSessionNote(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["setSessionNote", projectId],
    mutationFn: async (vars: { editSessionId: string; note: string }) => {
      const sb = createSupabaseBrowserClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error("No user");
      const data = qc.getQueryData<BootstrapData>(["schedule", projectId]);
      if (!data) return;

      const affected = data.history.filter(
        (h) => h.edit_session_id === vars.editSessionId && h.changed_by === user.id,
      );
      if (affected.length === 0) return;

      // Optimistic patch.
      const prevByIdEntries = affected.map((h) => [h.id, h] as const);
      const prevById = new Map(prevByIdEntries);
      qc.setQueryData(["schedule", projectId], (cur: BootstrapData | undefined) => {
        if (!cur) return cur;
        return {
          ...cur,
          history: cur.history.map((h) =>
            prevById.has(h.id) ? { ...h, session_note: vars.note } : h),
        };
      });

      // Mark the affected ids as inflight so the realtime echo doesn't fight us.
      for (const h of affected) markInflight(h.id);

      const { error } = await sb
        .from("activity_history")
        .update({ session_note: vars.note })
        .eq("edit_session_id", vars.editSessionId)
        .eq("changed_by", user.id);

      if (error) {
        // Rollback every row we touched.
        qc.setQueryData(["schedule", projectId], (cur: BootstrapData | undefined) => {
          if (!cur) return cur;
          return {
            ...cur,
            history: cur.history.map((h) => prevById.get(h.id) ?? h),
          };
        });
        toast.error(`Session note save failed: ${error.message}`);
      }
    },
  });
}
```

- [ ] **Step 4: Run test**

```bash
npx vitest run src/lib/state/mutations.set-session-note.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/state/mutations.ts src/lib/state/mutations.set-session-note.test.ts
git commit -m "feat(mutations): add useSetSessionNote bulk-patches history.session_note"
```

---

## Task 9: Fix three `insertHistoryRows` call sites to read project default

**Files:**
- Modify: `src/lib/state/mutations.ts`

`useSaveActivity` (line 264) already does this correctly. Three other call sites hardcode `"shared"`:
- `useInsertDependency` — line 311
- `useDeleteActivity` — line 345
- `useToggleDependencyActive` — line 385

- [ ] **Step 1: Refactor each call site to read the bootstrap project default**

In `useInsertDependency`, replace the `await insertHistoryRows(... "shared" ...)` block with this — note we already have `data` available from the optimistic patch step; if not, fetch from `qc.getQueryData`:

```ts
      const cache = qc.getQueryData<BootstrapData>(["schedule", projectId]);
      const visibility = cache?.project.comment_visibility_default === "shared" ? "shared" : "internal";
      await insertHistoryRows(
        sb,
        [{
          projectId, entityType: "dependency", entityId: data.id, field: "created",
          oldValue: null, newValue: `${vars.predecessorId}→${vars.successorId} ${vars.type}+${vars.lag}`,
        }],
        sessionId,
        visibility,
        user.id,
      );
```

Apply the same pattern in `useDeleteActivity` and `useToggleDependencyActive`. (`useToggleDependencyActive` already has `data` in scope from `qc.getQueryData<BootstrapData>` — reuse it directly.)

- [ ] **Step 2: Verify no remaining hardcoded `"shared"` in `insertHistoryRows` calls**

```bash
grep -n 'insertHistoryRows' src/lib/state/mutations.ts | grep -v 'visibility'
grep -n '"shared"' src/lib/state/mutations.ts
```

The first command should show all four call sites; the second should reveal no `"shared"` literal inside an `insertHistoryRows` arg list. (`"shared"` may still appear in the cascade `sessionNote: "engine_cascade"` literal — that's unrelated.)

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: PASS. If any test asserts that history rows are `visibility: "shared"`, update its fixture to use the seeded project's default (`"internal"`) or pass an explicit project override.

- [ ] **Step 4: Commit**

```bash
git add src/lib/state/mutations.ts
git commit -m "fix(mutations): three history-write sites now read project comment_visibility_default"
```

---

## Task 10: Realtime event union — add `activity_history` UPDATE variant

**Files:**
- Modify: `src/lib/realtime/events.ts`

- [ ] **Step 1: Extend the union**

In `src/lib/realtime/events.ts` line 26, change:

```ts
  | { table: "activity_history"; type: "INSERT"; new: DbActivityHistory };
```

to:

```ts
  | { table: "activity_history"; type: "INSERT"; new: DbActivityHistory }
  | { table: "activity_history"; type: "UPDATE"; new: DbActivityHistory };
```

- [ ] **Step 2: Confirm typecheck**

```bash
npm run typecheck
```

Expected: clean (no consumers exhaustively switch on `activity_history` type yet — the new case will surface in Task 11's reducer tests).

- [ ] **Step 3: Commit**

```bash
git add src/lib/realtime/events.ts
git commit -m "feat(realtime): add UPDATE variant for activity_history events"
```

---

## Task 11: Realtime reducer — handle `activity_history` UPDATE

**Files:**
- Modify: `src/lib/realtime/reducers.ts`
- Modify: `src/lib/realtime/reducers.test.ts`

- [ ] **Step 1: Write the failing test cases**

Open `src/lib/realtime/reducers.test.ts`. Find the existing describe block for `activity_history` (or wherever the INSERT case lives). Add two cases:

```ts
  it("activity_history UPDATE replaces the row by id", () => {
    const original: DbActivityHistory = {
      id: "h1", project_id: PID, edit_session_id: "es1",
      entity_type: "activity", entity_id: "a1", field: "name",
      old_value: "old", new_value: "new",
      changed_by: "u1", changed_at: "2026-05-24T12:00:00Z",
      visibility: "internal", session_note: null,
    };
    const data: BootstrapData = { ...emptyBootstrap(), history: [original] };
    const updated: DbActivityHistory = { ...original, session_note: "re-sequenced concrete" };

    const next = applyRealtimeEvent(data, {
      table: "activity_history", type: "UPDATE", new: updated,
    });

    expect(next.history).toHaveLength(1);
    expect(next.history[0].session_note).toBe("re-sequenced concrete");
  });

  it("activity_history UPDATE for unknown id is a no-op", () => {
    const data: BootstrapData = { ...emptyBootstrap(), history: [] };
    const updated: DbActivityHistory = {
      id: "h-missing", project_id: PID, edit_session_id: "es1",
      entity_type: "activity", entity_id: "a1", field: "name",
      old_value: "old", new_value: "new",
      changed_by: "u1", changed_at: "2026-05-24T12:00:00Z",
      visibility: "internal", session_note: "note",
    };
    const next = applyRealtimeEvent(data, {
      table: "activity_history", type: "UPDATE", new: updated,
    });
    expect(next.history).toEqual([]);
  });
```

(If `emptyBootstrap()` helper doesn't exist in this file, copy the fixture-builder used in the existing reducer tests verbatim. The reducer-test file already imports the BootstrapData type — match what's there.)

- [ ] **Step 2: Run — fail**

```bash
npx vitest run src/lib/realtime/reducers.test.ts
```

Expected: FAIL — the existing `reduceHistory` doesn't switch on type; it assumes INSERT and tries `data.history.some((h) => h.id === event.new.id)`. The UPDATE case currently returns `data` unchanged after appending (look at lines 143–150). The "unknown id no-op" test may already pass accidentally; the "replaces the row" test will fail.

- [ ] **Step 3: Implement**

Replace `reduceHistory` in `src/lib/realtime/reducers.ts` (lines 143–150) with:

```ts
function reduceHistory(
  data: BootstrapData,
  event: Extract<RealtimeRowEvent, { table: "activity_history" }>,
): BootstrapData {
  if (event.type === "INSERT") {
    // append-only; no echo filter
    if (data.history.some((h) => h.id === event.new.id)) return data;
    return { ...data, history: [event.new, ...data.history] };
  }
  // UPDATE — replace by id; no-op if absent (late-bind or echo).
  const idx = data.history.findIndex((h) => h.id === event.new.id);
  if (idx === -1) return data;
  const next = [...data.history];
  next[idx] = event.new;
  return { ...data, history: next };
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/lib/realtime/reducers.test.ts
```

Expected: PASS, including the two new cases.

- [ ] **Step 5: Sanity-check the normalize layer doesn't drop UPDATE**

Re-read `src/lib/realtime/normalize.ts`. Confirm the function returns the UPDATE payload through the generic branch (it does — `payload.eventType` flows through to the returned object's `type` field). No change required.

- [ ] **Step 6: Commit**

```bash
git add src/lib/realtime/reducers.ts src/lib/realtime/reducers.test.ts
git commit -m "feat(realtime): reduceHistory handles UPDATE for session-note backfill"
```

---

## Task 12: Component — `CommentItem`

**Files:**
- Create: `src/components/schedule/SidePanel/CommentItem.tsx`
- Create: `src/components/schedule/SidePanel/CommentItem.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/schedule/SidePanel/CommentItem.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommentItem } from "./CommentItem";
import type { DbComment, UserLookupEntry } from "@/lib/schedule/types";

const author: UserLookupEntry = { id: "u1", display_name: "Tanner", company_id: "c1", color: "#ff0000" };
const baseComment: DbComment = {
  id: "c1", project_id: "p1", author_user_id: "u1",
  body: "hello", parent_comment_id: null, scope: "project",
  target_activity_id: null, visibility: "shared",
  created_at: "2026-05-24T12:00:00Z", edited_at: null, deleted_at: null,
};

describe("CommentItem", () => {
  it("renders body + author display name + color chip", () => {
    render(<CommentItem comment={baseComment} author={author} isOwn={false} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("Tanner")).toBeInTheDocument();
  });

  it("shows (edited) when edited_at is set", () => {
    render(<CommentItem comment={{ ...baseComment, edited_at: "2026-05-24T13:00:00Z" }}
      author={author} isOwn={false} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/\(edited\)/i)).toBeInTheDocument();
  });

  it("shows tombstone and no buttons when deleted_at is set", () => {
    render(<CommentItem comment={{ ...baseComment, deleted_at: "2026-05-24T14:00:00Z" }}
      author={author} isOwn={true} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/\[deleted by author\]/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("renders edit + delete buttons only when isOwn", () => {
    const { rerender } = render(<CommentItem comment={baseComment} author={author} isOwn={false} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    rerender(<CommentItem comment={baseComment} author={author} isOwn={true} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("clicking Edit enters inline edit; Save calls onEdit with new body; Cancel reverts", () => {
    const onEdit = vi.fn();
    render(<CommentItem comment={baseComment} author={author} isOwn={true} onEdit={onEdit} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "edited body" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onEdit).toHaveBeenCalledWith("edited body");
  });

  it("clicking Delete calls onDelete immediately (no confirm dialog)", () => {
    const onDelete = vi.fn();
    render(<CommentItem comment={baseComment} author={author} isOwn={true} onEdit={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run — fail**

```bash
npx vitest run src/components/schedule/SidePanel/CommentItem.test.tsx
```

Expected: FAIL — `CommentItem` does not exist.

- [ ] **Step 3: Implement**

Create `src/components/schedule/SidePanel/CommentItem.tsx`:

```tsx
"use client";

import { clsx } from "clsx";
import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { DbComment, UserLookupEntry } from "@/lib/schedule/types";

interface Props {
  comment: DbComment;
  author: UserLookupEntry | null;
  isOwn: boolean;
  onEdit: (newBody: string) => void;
  onDelete: () => void;
}

export function CommentItem({ comment, author, isOwn, onEdit, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);

  const isDeleted = comment.deleted_at !== null;
  const wasEdited = comment.edited_at !== null && !isDeleted;

  function save() {
    if (draft.trim().length > 0 && draft !== comment.body) {
      onEdit(draft);
    }
    setEditing(false);
  }

  return (
    <div className="mb-2 rounded border border-slate-200 bg-white p-2">
      <div className="mb-1 flex items-center gap-2 text-[10px] text-slate-500">
        {author && (
          <span className="inline-flex items-center gap-1">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: author.color }}
            />
            <span className="font-medium text-slate-700">{author.display_name}</span>
          </span>
        )}
        <span className={clsx("rounded px-1", comment.visibility === "internal" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700")}>
          {comment.visibility}
        </span>
        <span>{new Date(comment.created_at).toLocaleString()}</span>
        {wasEdited && <span className="italic">(edited)</span>}
      </div>

      {isDeleted ? (
        <div className="italic text-slate-400">[deleted by author]</div>
      ) : editing ? (
        <div className="flex flex-col gap-1">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full rounded border border-slate-200 p-1 text-xs"
            autoFocus
          />
          <div className="flex gap-1">
            <button onClick={save} className="rounded bg-sky-600 px-2 py-0.5 text-[11px] text-white hover:bg-sky-700">Save</button>
            <button onClick={() => { setDraft(comment.body); setEditing(false); }} className="rounded px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100">Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className="text-slate-700 whitespace-pre-wrap">{comment.body}</div>
          {isOwn && (
            <div className="mt-1 flex gap-1 text-slate-400">
              <button onClick={() => setEditing(true)} aria-label="Edit" className="hover:text-slate-700">
                <Pencil size={12} />
              </button>
              <button onClick={onDelete} aria-label="Delete" className="hover:text-rose-600">
                <Trash2 size={12} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/components/schedule/SidePanel/CommentItem.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/schedule/SidePanel/CommentItem.tsx \
        src/components/schedule/SidePanel/CommentItem.test.tsx
git commit -m "feat(ui): CommentItem with author, (edited), tombstone, and own-comment edit+delete"
```

---

## Task 13: Component — `EditSessionGroup`

**Files:**
- Create: `src/components/schedule/SidePanel/EditSessionGroup.tsx`
- Create: `src/components/schedule/SidePanel/EditSessionGroup.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/schedule/SidePanel/EditSessionGroup.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditSessionGroup } from "./EditSessionGroup";
import type { DbActivityHistory, UserLookupEntry } from "@/lib/schedule/types";

const author: UserLookupEntry = { id: "u1", display_name: "Tanner", company_id: "c1", color: "#22c55e" };

function row(i: number, note: string | null): DbActivityHistory {
  return {
    id: `h${i}`, project_id: "p1", edit_session_id: "es1",
    entity_type: "activity", entity_id: `a${i}`, field: "name",
    old_value: `old${i}`, new_value: `new${i}`,
    changed_by: "u1", changed_at: "2026-05-24T12:00:00Z",
    visibility: "internal", session_note: note,
  } as DbActivityHistory;
}

describe("EditSessionGroup", () => {
  it("renders a header with 'made N changes' and the author name", () => {
    render(<EditSessionGroup author={author} rows={[row(1, null), row(2, null), row(3, null)]} />);
    expect(screen.getByText(/Tanner/)).toBeInTheDocument();
    expect(screen.getByText(/made 3 changes/i)).toBeInTheDocument();
  });

  it("renders the session note if present on any row", () => {
    render(<EditSessionGroup author={author} rows={[row(1, "re-sequenced concrete"), row(2, "re-sequenced concrete")]} />);
    expect(screen.getByText("re-sequenced concrete")).toBeInTheDocument();
  });

  it("is collapsed by default; expanding reveals row details", () => {
    render(<EditSessionGroup author={author} rows={[row(1, null), row(2, null)]} />);
    // collapsed: row body fields not visible
    expect(screen.queryByText(/old1/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /expand/i }));
    expect(screen.getByText(/old1/)).toBeInTheDocument();
    expect(screen.getByText(/old2/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — fail**

```bash
npx vitest run src/components/schedule/SidePanel/EditSessionGroup.test.tsx
```

Expected: FAIL — component missing.

- [ ] **Step 3: Implement**

Create `src/components/schedule/SidePanel/EditSessionGroup.tsx`:

```tsx
"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { DbActivityHistory, UserLookupEntry } from "@/lib/schedule/types";

interface Props {
  author: UserLookupEntry | null;
  rows: DbActivityHistory[];
}

export function EditSessionGroup({ author, rows }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;

  const note = rows.find((r) => r.session_note !== null)?.session_note ?? null;
  const visibility = rows[0].visibility;  // all rows in a session share visibility
  const when = new Date(rows[0].changed_at).toLocaleString();
  const name = author?.display_name ?? "Someone";

  return (
    <div className="mb-2 rounded border border-slate-200 bg-white">
      <button
        aria-label={expanded ? "Collapse" : "Expand"}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 p-2 text-left"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <div className="flex flex-1 flex-col">
          <div className="flex items-center gap-2 text-[10px] text-slate-500">
            {author && (
              <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: author.color }} />
            )}
            <span className="font-medium text-slate-700">{name}</span>
            <span>made {rows.length} changes</span>
            <span>·</span>
            <span>{when}</span>
            <span className={`ml-auto rounded px-1 ${visibility === "internal" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
              {visibility}
            </span>
          </div>
          {note && <div className="mt-0.5 text-xs italic text-slate-600">{note}</div>}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-2 pb-2 pt-1">
          {rows.map((r) => (
            <div key={r.id} className="text-[11px] text-slate-700">
              {r.entity_type}.{r.field}: {r.old_value ?? "∅"} → {r.new_value ?? "∅"}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/components/schedule/SidePanel/EditSessionGroup.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/schedule/SidePanel/EditSessionGroup.tsx \
        src/components/schedule/SidePanel/EditSessionGroup.test.tsx
git commit -m "feat(ui): EditSessionGroup collapsible card with header + note"
```

---

## Task 14: Component — `SessionNoteModal`

**Files:**
- Create: `src/components/schedule/SessionNoteModal.tsx`
- Create: `src/components/schedule/SessionNoteModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/schedule/SessionNoteModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionNoteModal } from "./SessionNoteModal";

describe("SessionNoteModal", () => {
  it("calls onSave with the note text and onClose when Save is clicked", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<SessionNoteModal isOpen={true} changeCount={3} onSave={onSave} onClose={onClose} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "re-sequenced concrete" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith("re-sequenced concrete");
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose but not onSave when Skip is clicked", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<SessionNoteModal isOpen={true} changeCount={3} onSave={onSave} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /skip/i }));

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("treats Save with an empty textarea as Skip (no onSave call)", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<SessionNoteModal isOpen={true} changeCount={3} onSave={onSave} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("Esc closes the modal without saving", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<SessionNoteModal isOpen={true} changeCount={3} onSave={onSave} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("returns null when isOpen is false", () => {
    const { container } = render(<SessionNoteModal isOpen={false} changeCount={3} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run — fail**

```bash
npx vitest run src/components/schedule/SessionNoteModal.test.tsx
```

Expected: FAIL — component missing.

- [ ] **Step 3: Implement**

Create `src/components/schedule/SessionNoteModal.tsx`:

```tsx
"use client";

import { useState, useEffect, useRef } from "react";

interface Props {
  isOpen: boolean;
  changeCount: number;
  onSave: (note: string) => void;
  onClose: () => void;
}

export function SessionNoteModal({ isOpen, changeCount, onSave, onClose }: Props) {
  const [note, setNote] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setNote("");
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  function handleSave() {
    const trimmed = note.trim();
    if (trimmed.length > 0) onSave(trimmed);
    onClose();
  }

  function handleSkip() {
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[400px] rounded-md bg-white p-4 shadow-xl">
        <div className="mb-2 text-sm font-medium text-slate-800">
          Add a note for this session?
        </div>
        <div className="mb-3 text-xs text-slate-500">
          You made {changeCount} change{changeCount === 1 ? "" : "s"}. A short summary helps teammates skim the feed.
        </div>
        <textarea
          ref={textareaRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSave(); }
            if (e.key === "Escape") { e.preventDefault(); handleSkip(); }
          }}
          rows={3}
          placeholder="e.g., re-sequenced concrete to fit inspection"
          className="w-full rounded border border-slate-300 p-2 text-sm"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={handleSkip} className="rounded px-3 py-1 text-xs text-slate-600 hover:bg-slate-100">
            Skip
          </button>
          <button onClick={handleSave} className="rounded bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-700">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/components/schedule/SessionNoteModal.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/schedule/SessionNoteModal.tsx \
        src/components/schedule/SessionNoteModal.test.tsx
git commit -m "feat(ui): SessionNoteModal with Save/Skip, Enter/Esc, empty=Skip"
```

---

## Task 15: SidePanel — wire it all together

**Files:**
- Modify: `src/components/schedule/SidePanel/SidePanel.tsx`

This task is the biggest UI change. It is one task because the changes are tightly coupled — splitting them would leave intermediate broken states.

- [ ] **Step 1: Rewrite `SidePanel.tsx`**

Replace the entire file contents with:

```tsx
"use client";

import { clsx } from "clsx";
import { useMemo } from "react";
import type { BootstrapData, DbActivityHistory } from "@/lib/schedule/types";
import { useUiStore } from "@/lib/state/ui-store";
import { useUpdateComment, useSoftDeleteComment } from "@/lib/state/mutations";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import { CommentComposer } from "./CommentComposer";
import { CommentItem } from "./CommentItem";
import { EditSessionGroup } from "./EditSessionGroup";

type KindFilter = "all" | "comments" | "history";

interface Props {
  bootstrap: BootstrapData;
  projectId: string;
}

type FeedEntry =
  | { kind: "comment"; commentId: string; at: string; visibility: "internal" | "shared" }
  | { kind: "history-single"; row: DbActivityHistory; at: string; visibility: "internal" | "shared" }
  | { kind: "history-group"; rows: DbActivityHistory[]; at: string; visibility: "internal" | "shared"; authorId: string };

export function SidePanel({ bootstrap, projectId }: Props) {
  const selectedId = useUiStore((s) => s.selectedActivityId);
  const visibilityFilter = useUiStore((s) => s.visibilityFilter);
  const setVisibilityFilter = useUiStore((s) => s.setVisibilityFilter);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

  const updateComment = useUpdateComment(projectId);
  const softDeleteComment = useSoftDeleteComment(projectId);

  const [currentUserId, setCurrentUserId] = useState<string>("");
  useEffect(() => {
    const sb = createSupabaseBrowserClient();
    void sb.auth.getUser().then(({ data: { user } }) => { if (user) setCurrentUserId(user.id); });
  }, []);

  const entries = useMemo<FeedEntry[]>(() => {
    // Filter comments by scope.
    const comments = bootstrap.comments
      .filter((c) =>
        selectedId
          ? c.scope === "activity" && c.target_activity_id === selectedId
          : c.scope === "project",
      )
      .map<FeedEntry>((c) => ({
        kind: "comment", commentId: c.id, at: c.created_at, visibility: c.visibility,
      }));

    // Group history rows by edit_session_id; rows without a session id stay single.
    const historyRows = bootstrap.history.filter((h) =>
      selectedId ? h.entity_id === selectedId : true,
    );
    const bySession = new Map<string, DbActivityHistory[]>();
    const singles: DbActivityHistory[] = [];
    for (const h of historyRows) {
      if (!h.edit_session_id) { singles.push(h); continue; }
      const arr = bySession.get(h.edit_session_id) ?? [];
      arr.push(h);
      bySession.set(h.edit_session_id, arr);
    }

    const historyEntries: FeedEntry[] = [];
    for (const [, rows] of bySession) {
      if (rows.length === 1) {
        const r = rows[0];
        historyEntries.push({ kind: "history-single", row: r, at: r.changed_at, visibility: r.visibility });
      } else {
        // newest changed_at represents the group's time
        const sorted = [...rows].sort((a, b) => a.changed_at.localeCompare(b.changed_at));
        const head = sorted[0];
        historyEntries.push({
          kind: "history-group", rows: sorted, at: head.changed_at,
          visibility: head.visibility, authorId: head.changed_by,
        });
      }
    }
    for (const r of singles) {
      historyEntries.push({ kind: "history-single", row: r, at: r.changed_at, visibility: r.visibility });
    }

    // Combine + filter by kind + visibility.
    const all: FeedEntry[] = [...comments, ...historyEntries];
    const filtered = all.filter((e) => {
      if (kindFilter === "comments" && e.kind !== "comment") return false;
      if (kindFilter === "history" && e.kind === "comment") return false;
      if (visibilityFilter !== "all" && e.visibility !== visibilityFilter) return false;
      return true;
    });
    filtered.sort((a, b) => b.at.localeCompare(a.at));
    return filtered;
  }, [bootstrap, selectedId, kindFilter, visibilityFilter]);

  // External users can't see internal at all — hide the chip.
  // We infer external from absence of any internal items in the bootstrap (RLS-filtered).
  const showInternalChip = bootstrap.comments.some((c) => c.visibility === "internal")
                        || bootstrap.history.some((h) => h.visibility === "internal");

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 p-3">
        <div className="text-xs font-medium text-slate-700">
          {selectedId ? "Activity feed" : "Project feed"}
        </div>
        <div className="mt-2 flex gap-1 text-[10px]">
          {(["all", "comments", "history"] as KindFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setKindFilter(f)}
              className={clsx(
                "rounded px-2 py-0.5",
                kindFilter === f ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-100",
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="mt-1 flex gap-1 text-[10px]" data-testid="visibility-filter">
          {(["all", ...(showInternalChip ? ["internal"] as const : []), "shared"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setVisibilityFilter(v)}
              className={clsx(
                "rounded px-2 py-0.5",
                visibilityFilter === v ? "bg-slate-700 text-white" : "text-slate-600 hover:bg-slate-100",
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 text-xs">
        {entries.length === 0 ? (
          <div className="p-2 text-slate-400">No items.</div>
        ) : (
          <ul className="m-0 list-none p-0">
            {entries.map((e) => {
              if (e.kind === "comment") {
                const c = bootstrap.comments.find((x) => x.id === e.commentId)!;
                const author = bootstrap.users[c.author_user_id] ?? null;
                return (
                  <li key={`c-${c.id}`}>
                    <CommentItem
                      comment={c}
                      author={author}
                      isOwn={c.author_user_id === currentUserId}
                      onEdit={(body) => updateComment.mutate({ commentId: c.id, body })}
                      onDelete={() => softDeleteComment.mutate({ commentId: c.id })}
                    />
                  </li>
                );
              }
              if (e.kind === "history-group") {
                const author = bootstrap.users[e.authorId] ?? null;
                return (
                  <li key={`g-${e.rows[0].edit_session_id}`}>
                    <EditSessionGroup author={author} rows={e.rows} />
                  </li>
                );
              }
              const r = e.row;
              const author = bootstrap.users[r.changed_by] ?? null;
              return (
                <li key={`h-${r.id}`}>
                  <div className="mb-2 rounded border border-slate-200 bg-white p-2">
                    <div className="mb-1 flex items-center gap-2 text-[10px] text-slate-500">
                      {author && <>
                        <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: author.color }} />
                        <span className="font-medium text-slate-700">{author.display_name}</span>
                      </>}
                      <span className={clsx("rounded px-1", r.visibility === "internal" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700")}>
                        {r.visibility}
                      </span>
                      <span>{new Date(r.changed_at).toLocaleString()}</span>
                    </div>
                    <div className="text-slate-700">
                      {r.entity_type}.{r.field}: {r.old_value ?? "∅"} → {r.new_value ?? "∅"}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <CommentComposer projectId={projectId} defaultVisibility={bootstrap.project.comment_visibility_default} />
    </div>
  );
}
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: any existing SidePanel-related tests pass; `CommentItem` and `EditSessionGroup` tests still pass. If something fails because of the new `defaultVisibility` prop on `CommentComposer`, that's expected — Task 16 fixes it. To keep this commit green, temporarily add a default value `defaultVisibility = "internal"` on the prop in `CommentComposer.tsx` until Task 16 lands.

If `external-user.spec.ts` (Playwright) is part of the default `npm test`, expect it to still pass — the `<li>` ancestor in its assertion still wraps each item.

- [ ] **Step 3: Lint + typecheck**

```bash
npm run lint && npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/schedule/SidePanel/SidePanel.tsx
git commit -m "feat(ui): SidePanel groups history by session, renders authors, adds visibility filter"
```

---

## Task 16: CommentComposer — accept `defaultVisibility` prop

**Files:**
- Modify: `src/components/schedule/SidePanel/CommentComposer.tsx`

- [ ] **Step 1: Update the component signature + initial state**

Replace the top of `CommentComposer.tsx` so the function signature is:

```tsx
interface Props {
  projectId: string;
  defaultVisibility: "internal" | "shared";
}

export function CommentComposer({ projectId, defaultVisibility }: Props) {
  const selectedId = useUiStore((s) => s.selectedActivityId);
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"internal" | "shared">(defaultVisibility);
  const post = usePostComment(projectId);
  // ... rest unchanged
```

- [ ] **Step 2: Verify SidePanel call site**

Search for `<CommentComposer` and confirm it now passes `defaultVisibility`. (Task 15 already added it.)

```bash
grep -n CommentComposer src/components/schedule
```

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src/components/schedule/SidePanel/CommentComposer.tsx
git commit -m "feat(ui): CommentComposer reads defaultVisibility from project setting"
```

---

## Task 17: EditModeBanner — Done opens `SessionNoteModal`

**Files:**
- Modify: `src/components/schedule/EditModeBanner.tsx`

- [ ] **Step 1: Rewrite the component**

Replace `src/components/schedule/EditModeBanner.tsx` entirely:

```tsx
"use client";

import { Edit3 } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUiStore } from "@/lib/state/ui-store";
import { useSetSessionNote } from "@/lib/state/mutations";
import { SessionNoteModal } from "./SessionNoteModal";
import type { BootstrapData } from "@/lib/schedule/types";

interface Props {
  projectId: string;
}

export function EditModeBanner({ projectId }: Props) {
  const mode = useUiStore((s) => s.mode);
  const editSessionId = useUiStore((s) => s.editSessionId);
  const exit = useUiStore((s) => s.exitEditMode);
  const qc = useQueryClient();
  const setSessionNote = useSetSessionNote(projectId);
  const [showModal, setShowModal] = useState(false);

  if (mode !== "edit") return null;

  function handleDoneClick() {
    const data = qc.getQueryData<BootstrapData>(["schedule", projectId]);
    const changeCount = data?.history.filter((h) => h.edit_session_id === editSessionId).length ?? 0;
    if (changeCount === 0 || !editSessionId) {
      exit();
      return;
    }
    setShowModal(true);
  }

  function handleSave(note: string) {
    if (editSessionId) {
      setSessionNote.mutate({ editSessionId, note });
    }
    // exit happens via onClose
  }

  function handleClose() {
    setShowModal(false);
    exit();
  }

  const data = qc.getQueryData<BootstrapData>(["schedule", projectId]);
  const changeCount = data?.history.filter((h) => h.edit_session_id === editSessionId).length ?? 0;

  return (
    <>
      <div className="flex items-center justify-between border-b border-amber-300 bg-amber-100 px-4 py-1.5 text-xs text-amber-900">
        <div className="flex items-center gap-2">
          <Edit3 size={14} />
          <span className="font-medium">Edit mode</span>
          <span className="text-amber-800/80">
            Changes persist on release. Discard only reverts local view — already-saved changes stay.
          </span>
        </div>
        <button
          onClick={handleDoneClick}
          className="rounded bg-amber-500 px-2 py-1 text-xs font-medium text-white hover:bg-amber-600"
        >
          Done
        </button>
      </div>
      <SessionNoteModal
        isOpen={showModal}
        changeCount={changeCount}
        onSave={handleSave}
        onClose={handleClose}
      />
    </>
  );
}
```

- [ ] **Step 2: Update the only call site**

`src/components/schedule/ScheduleApp.tsx` renders `<EditModeBanner />`. Add the `projectId` prop:

```tsx
      <EditModeBanner projectId={projectId} />
```

- [ ] **Step 3: Run all tests + typecheck**

```bash
npm test && npm run typecheck
```

Expected: green. If a test mounts `<EditModeBanner />` without the prop, update it to pass a dummy id.

- [ ] **Step 4: Commit**

```bash
git add src/components/schedule/EditModeBanner.tsx src/components/schedule/ScheduleApp.tsx
git commit -m "feat(ui): EditModeBanner opens SessionNoteModal on Done; skips when no changes"
```

---

## Task 18: Playwright — extend scheduler happy-path

**Files:**
- Modify: `tests/e2e/scheduler-happy-path.spec.ts`

- [ ] **Step 1: Add the session-note + edit-comment + delete-comment scenario**

Append a new `test()` to `tests/e2e/scheduler-happy-path.spec.ts`. Do not modify existing tests. The exact scenario:

```ts
test("session note + edit + delete comment flow", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("scheduler@ihs.test");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Riverside Office Build")).toBeVisible({ timeout: 10_000 });

  // Enter Edit Mode.
  await page.getByRole("button", { name: /edit/i }).first().click();
  await expect(page.getByText(/Edit mode/i)).toBeVisible();

  // Make at least two edits using the existing inline-edit cells.
  // (Adjust selectors to match the cell shape in your current ActivityTable.)
  const firstNameCell = page.locator('[data-testid="activity-name-cell"]').first();
  await firstNameCell.click();
  await page.keyboard.type(" v1");
  await page.keyboard.press("Enter");

  const secondNameCell = page.locator('[data-testid="activity-name-cell"]').nth(1);
  await secondNameCell.click();
  await page.keyboard.type(" v1");
  await page.keyboard.press("Enter");

  // Click Done → modal appears.
  await page.getByRole("button", { name: /done/i }).click();
  const note = page.getByPlaceholder(/re-sequenced concrete/i);
  await expect(note).toBeVisible();
  await note.fill("re-sequenced concrete");
  await page.getByRole("button", { name: /save/i }).click();

  // Modal closes; banner gone; one group card visible with note.
  await expect(page.getByText(/Edit mode/i)).not.toBeVisible();
  await expect(page.getByText(/made \d+ changes/i)).toBeVisible();
  await expect(page.getByText("re-sequenced concrete")).toBeVisible();

  // Post a comment, then edit it, then soft-delete it.
  const composer = page.getByPlaceholder(/Add a (project|activity) comment/i);
  await composer.fill("typo here");
  await page.getByRole("button", { name: /^post$/i }).click();
  await expect(page.getByText("typo here")).toBeVisible();

  // Hover (so action buttons show), click edit.
  await page.getByText("typo here").hover();
  await page.getByRole("button", { name: /^edit$/i }).click();
  const editTextarea = page.getByRole("textbox").last();
  await editTextarea.fill("typo fixed");
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByText("typo fixed")).toBeVisible();
  await expect(page.getByText(/\(edited\)/i)).toBeVisible();

  // Delete the same comment.
  await page.getByText("typo fixed").hover();
  await page.getByRole("button", { name: /^delete$/i }).click();
  await expect(page.getByText(/\[deleted by author\]/i)).toBeVisible();
});
```

(If the `data-testid="activity-name-cell"` doesn't exist on the current cells, add it as part of this task — single line in `ActivityNameCell.tsx`. Or pick a selector that already exists.)

- [ ] **Step 2: Run the Playwright suite**

```bash
npx playwright test scheduler-happy-path
```

Expected: PASS. If the new scenario fails on a selector, refine the selector — do not lower the assertion strength.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/scheduler-happy-path.spec.ts \
        src/components/schedule/ActivityTable/ActivityNameCell.tsx   # only if data-testid added
git commit -m "test(e2e): scheduler session-note + edit + delete comment flow"
```

---

## Task 19: Playwright — extend external-user spec

**Files:**
- Modify: `tests/e2e/external-user.spec.ts`

- [ ] **Step 1: Add visibility-filter assertion**

Inside the existing `test("external trade-partner viewer ...")` block, after the internal-chip assertion, add:

```ts
  // Phase 7: external users have no `internal` option in the visibility filter chip row.
  const visFilter = page.getByTestId("visibility-filter");
  await expect(visFilter).toBeVisible();
  await expect(visFilter.getByRole("button", { name: /^internal$/i })).toHaveCount(0);
  // `shared` and `all` are present.
  await expect(visFilter.getByRole("button", { name: /^shared$/i })).toBeVisible();
  await expect(visFilter.getByRole("button", { name: /^all$/i })).toBeVisible();
```

- [ ] **Step 2: Run the Playwright suite**

```bash
npx playwright test external-user
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/external-user.spec.ts
git commit -m "test(e2e): external user has no 'internal' visibility filter option"
```

---

## Task 20: Full-suite verification + PR

**Files:** none (verification only).

- [ ] **Step 1: Full local verification**

```bash
npm run typecheck && npm run lint && npm test
npx playwright test
```

Expected: every check green. Document final test counts for the PR description.

- [ ] **Step 2: Manual smoke (Phase 7 done-when)**

Spin up two browser contexts (e.g., Chrome + an incognito window):
1. Tab A — sign in as `scheduler@ihs.test`. Tab B — sign in as `pm@ihs.test`. Tab C (optional) — sign in as `tp-viewer@trade.test`.
2. In Tab A: enter Edit Mode, modify 3 activities, click Done, type "re-sequenced concrete," Save.
3. In Tab B: see a single grouped card "<name> made 3 changes · re-sequenced concrete" appear within ~1 second (Phase 6 realtime + Task 11 UPDATE handler).
4. In Tab A: post an internal comment "internal coord," then edit it to "internal coordination," then soft-delete it. Confirm `(edited)` and `[deleted by author]` render.
5. In Tab C: confirm no internal sessions/comments are visible; the visibility filter offers only `all` and `shared`.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feat/phase-7-comments
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "Phase 7: comments side panel — field-ready v1" --body "$(cat <<'EOF'
## Summary
- Author display in the feed (new `BootstrapData.users` lookup + `deriveColor` pre-compute).
- Edit-session grouping in the side panel (`<EditSessionGroup>` collapsible card; single-row sessions render flat).
- Done-Save flow opens `<SessionNoteModal>` (blocking modal with Save / Skip; Enter = Save, Esc = Skip; empty = Skip).
- Visibility filter chips (`all / internal / shared`) — `internal` hidden for external users.
- Composer reads `project.comment_visibility_default` for initial visibility.
- Own-comment edit + soft-delete with `(edited)` hint and `[deleted by author]` tombstone.
- Three previously-hardcoded `insertHistoryRows("shared")` call sites now read the project default.
- New RLS policy allows authors to UPDATE their own `activity_history` rows for session-note backfill.
- Realtime: `activity_history` UPDATE variant + reducer case so session notes propagate live.

## Test plan
- [x] Unit: `useUpdateComment`, `useSoftDeleteComment`, `useSetSessionNote`, `buildUserLookup`, `CommentItem`, `EditSessionGroup`, `SessionNoteModal`, reducer UPDATE case.
- [x] E2E: scheduler-happy-path covers Done/Save modal + group header + edit/delete comment.
- [x] E2E: external-user spec confirms no `internal` filter chip is shown.
- [x] Manual: two-context smoke (scheduler + pm) confirms session note + group propagate within ~1s.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Done.

---

## Self-Review Summary (informational)

Coverage check against the spec:
- §1 In scope — author display (Task 3, 4, 12, 13, 15); edit-session grouping (Task 13, 15); session-note modal (Task 14, 17); visibility filter (Task 5, 15); composer default (Task 16); edit + soft-delete UI (Task 12, 15); history-visibility from project default (Task 9); realtime activity_history UPDATE (Task 10, 11). ✅
- §2 Data model — new RLS policy (Task 2). ✅
- §3 Bootstrap — users fetch + lookup (Task 4) + type (Task 3). ✅
- §4 Components — all three new components + three modified files mapped to Tasks 12–17. ✅
- §5 State & mutations — three hooks (Task 6, 7, 8); appendHistoryRows visibility fix (Task 9); Edit Mode flow (Task 17). ✅
- §6 Realtime — events.ts + reducers.ts (Tasks 10, 11). ✅
- §7 Testing — every test enumerated in the spec is in a task; Playwright extensions in Tasks 18, 19. ✅
- §8 Risks — flagged in the spec; no implementation knobs added beyond what's needed.
- §9 File map — every file in the spec's "to create" / "to modify" list appears in this plan.

No placeholders. Types consistent throughout (`useUpdateComment` arg shape matches between test and impl; `EditSessionGroup` props match between test and SidePanel call site; `SessionNoteModal` prop names consistent across the test, the modal, and `EditModeBanner`).
