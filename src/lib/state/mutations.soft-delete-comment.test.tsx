import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSoftDeleteComment } from "./mutations";
import type { BootstrapData, DbComment } from "@/lib/schedule/types";

const PROJECT_ID = "70000000-0000-0000-0000-000000000000";
const USER_ID = "u-self";

const sampleComment: DbComment = {
  id: "c1",
  project_id: PROJECT_ID,
  author_user_id: USER_ID,
  body: "some body",
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

let updateChain: {
  update: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
};
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
  updateChain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn(),
  };
  fromMock = vi.fn(() => updateChain);
  authMock = { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) };
  toastMock = { error: vi.fn(), warn: vi.fn() };
});

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
