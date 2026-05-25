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

// let-bound mocks (vitest hoisting safety)
let fromMock: ReturnType<typeof vi.fn>;
let authMock: { getUser: ReturnType<typeof vi.fn> };
let toastMock: { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ from: fromMock, auth: authMock }),
}));

vi.mock("./toasts", () => ({
  get toast() { return toastMock; },
}));

function wrapper(qc: QueryClient) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = "TestWrapper";
  return Wrapper;
}

beforeEach(() => {
  fromMock = vi.fn();
  authMock = { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) };
  toastMock = { error: vi.fn(), warn: vi.fn() };
});

describe("useSetSessionNote", () => {
  it("patches session_note on every row of the session in cache", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["schedule", PROJECT_ID], makeBootstrap());

    fromMock.mockReturnValueOnce({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ error: null })),
        })),
      })),
    });

    const { result } = renderHook(() => useSetSessionNote(PROJECT_ID), { wrapper: wrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync({ editSessionId: SESSION_ID, note: "re-sequenced concrete" });
    });

    const cached = qc.getQueryData<BootstrapData>(["schedule", PROJECT_ID]);
    expect(cached?.history.every((h) => h.session_note === "re-sequenced concrete")).toBe(true);
    expect(toastMock.error).not.toHaveBeenCalled();
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
    });

    const { result } = renderHook(() => useSetSessionNote(PROJECT_ID), { wrapper: wrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync({ editSessionId: SESSION_ID, note: "ouch" });
    });

    const cached = qc.getQueryData<BootstrapData>(["schedule", PROJECT_ID]);
    expect(cached?.history.every((h) => h.session_note === null)).toBe(true);
    expect(toastMock.error).toHaveBeenCalled();
  });
});
