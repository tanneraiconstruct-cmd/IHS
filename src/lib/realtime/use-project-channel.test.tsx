import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { BootstrapData } from "@/lib/schedule/types";
import { usePresenceStore } from "@/lib/state/presence-store";
import { useProjectChannel } from "./use-project-channel";

const PID = "00000000-0000-0000-0000-000000000001";

interface MockChannel {
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  track: ReturnType<typeof vi.fn>;
  untrack: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  presenceState: ReturnType<typeof vi.fn>;
  // Captured callbacks so tests can fire events.
  bindings: Record<string, Array<(payload: unknown) => void>>;
  subscribeCb: ((status: string) => void) | null;
}

function makeMockChannel(): MockChannel {
  const bindings: MockChannel["bindings"] = {};
  const ch: MockChannel = {
    bindings,
    subscribeCb: null,
    on: vi.fn().mockImplementation((event: string, opts: unknown, cb: unknown) => {
      const key = `${event}:${typeof opts === "object" && opts && "table" in opts ? (opts as { table: string }).table : (opts as { event?: string } | null)?.event ?? ""}`;
      (bindings[key] ||= []).push(cb as (p: unknown) => void);
      return ch;
    }),
    subscribe: vi.fn().mockImplementation((cb: (status: string) => void) => {
      ch.subscribeCb = cb;
      return ch;
    }),
    track: vi.fn().mockResolvedValue(undefined),
    untrack: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    presenceState: vi.fn().mockReturnValue({}),
  };
  return ch;
}

let mockChannel: MockChannel;
let mockClient: { channel: ReturnType<typeof vi.fn>; auth: { getUser: ReturnType<typeof vi.fn> } };

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => mockClient,
}));

beforeEach(() => {
  mockChannel = makeMockChannel();
  mockClient = {
    channel: vi.fn().mockReturnValue(mockChannel),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1", email: "alice@x.test" } } }) },
  };
  usePresenceStore.setState({ online: {}, connection: "connecting" });
});

afterEach(() => {
  vi.clearAllMocks();
});

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function seed(qc: QueryClient): BootstrapData {
  const data: BootstrapData = {
    project: { id: PID, name: "P", number: null, project_start: "2026-01-01",
      data_date: null, default_calendar_id: "cal",
      critical_float_threshold: 0, comment_visibility_default: "shared" },
    calendars: [], calendarExceptions: [], wbsNodes: [], activities: [],
    dependencies: [], constraints: [], comments: [], history: [],
    lookaheads: [], lookaheadTasks: [], users: {},
  };
  qc.setQueryData(["schedule", PID], data);
  return data;
}

describe("useProjectChannel", () => {
  it("subscribes to all six tables with project_id filter", async () => {
    const qc = new QueryClient();
    seed(qc);
    renderHook(() => useProjectChannel(PID), { wrapper: wrap(qc) });

    // wait for getUser → channel setup microtasks
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(mockClient.channel).toHaveBeenCalledWith(`project:${PID}`, expect.anything());
    const tables = mockChannel.on.mock.calls
      .filter((c) => c[0] === "postgres_changes")
      .map((c) => (c[1] as { table: string }).table)
      .sort();
    expect(tables).toEqual([
      "activities", "activity_constraints", "activity_history",
      "comments", "dependencies", "wbs_nodes",
    ]);
  });

  it("calls track() and invalidates queries on SUBSCRIBED", async () => {
    const qc = new QueryClient();
    seed(qc);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useProjectChannel(PID), { wrapper: wrap(qc) });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => { mockChannel.subscribeCb?.("SUBSCRIBED"); await Promise.resolve(); });

    expect(mockChannel.track).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1", editMode: false,
    }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["schedule", PID] });
    expect(usePresenceStore.getState().connection).toBe("live");
  });

  it("sets connection=offline on CHANNEL_ERROR", async () => {
    const qc = new QueryClient();
    seed(qc);
    renderHook(() => useProjectChannel(PID), { wrapper: wrap(qc) });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => { mockChannel.subscribeCb?.("CHANNEL_ERROR"); });
    expect(usePresenceStore.getState().connection).toBe("offline");
  });

  it("forwards a postgres_changes payload through reducers into the cache", async () => {
    const qc = new QueryClient();
    seed(qc);
    renderHook(() => useProjectChannel(PID), { wrapper: wrap(qc) });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const activitiesCallback = mockChannel.bindings["postgres_changes:activities"][0];
    await act(async () => {
      activitiesCallback({
        schema: "public", table: "activities", eventType: "INSERT",
        new: { id: "new-act", project_id: PID, wbs_node_id: null, name: "Hello",
          activity_type: "task", original_duration: 1, remaining_duration: 1,
          calendar_id: null, actual_start: null, actual_finish: null,
          percent_complete: 0, responsible_company_id: null,
          early_start: null, early_finish: null, late_start: null, late_finish: null,
          planned_start: null, planned_finish: null, total_float: null, free_float: null,
          is_critical: false, version: 1, deleted_at: null },
        old: {},
      });
    });

    const cache = qc.getQueryData<BootstrapData>(["schedule", PID]);
    expect(cache?.activities.some((a) => a.id === "new-act")).toBe(true);
  });

  it("writes presence sync events to the store", async () => {
    const qc = new QueryClient();
    seed(qc);
    renderHook(() => useProjectChannel(PID), { wrapper: wrap(qc) });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    mockChannel.presenceState.mockReturnValue({
      "u2": [{ userId: "u2", displayName: "Bob", color: "#222", editMode: true, joinedAt: "1" }],
    });
    const syncCallback = mockChannel.bindings["presence:sync"][0];
    await act(async () => { syncCallback({}); });

    expect(usePresenceStore.getState().online["u2"]?.displayName).toBe("Bob");
  });

  it("untracks + unsubscribes on unmount", async () => {
    const qc = new QueryClient();
    seed(qc);
    const { unmount } = renderHook(() => useProjectChannel(PID), { wrapper: wrap(qc) });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    unmount();
    expect(mockChannel.untrack).toHaveBeenCalled();
    expect(mockChannel.unsubscribe).toHaveBeenCalled();
  });
});
