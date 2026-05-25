import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LookaheadView } from "./LookaheadView";
import type { BootstrapData, IndexedResult, DbActivity, DbLookahead, DbLookaheadTask } from "@/lib/schedule/types";
import type { ScheduleResult } from "@/lib/schedule-engine";

function act(over: Partial<DbActivity> = {}): DbActivity {
  return {
    id: over.id ?? "A1", project_id: "p", wbs_node_id: null, name: "Mobilize",
    activity_type: "task", original_duration: 5, remaining_duration: 5,
    calendar_id: null, actual_start: null, actual_finish: null,
    percent_complete: 0, responsible_company_id: null,
    early_start: null, early_finish: null, late_start: null, late_finish: null,
    planned_start: null, planned_finish: null, total_float: null, free_float: null,
    is_critical: false, version: 1, deleted_at: null, ...over,
  };
}

function lookahead(over: Partial<DbLookahead> = {}): DbLookahead {
  return {
    id: over.id ?? "L1", project_id: "p", name: "Week 1",
    window_start: "2026-05-01", window_end: "2026-05-28",
    type: null, source_mode: "from_master", deleted_at: null, ...over,
  };
}

function task(over: Partial<DbLookaheadTask> = {}): DbLookaheadTask {
  return {
    id: over.id ?? "T1", lookahead_id: "L1", master_activity_id: null, name: "T1",
    offset_start: null, offset_finish: null, start_date: null, finish_date: null,
    crew: null, responsible_company_id: null, status: "not_started",
    percent_complete: 0, constraints_cleared: false, readiness_notes: null,
    deleted_at: null, ...over,
  };
}

function indexed(...rows: { id: string; plannedStart: string; plannedFinish: string }[]): IndexedResult {
  const byActivity = new Map<string, ScheduleResult["activities"][number]>();
  for (const r of rows) {
    byActivity.set(r.id, {
      id: r.id,
      earlyStart: r.plannedStart, earlyFinish: r.plannedFinish,
      lateStart: r.plannedStart, lateFinish: r.plannedFinish,
      plannedStart: r.plannedStart, plannedFinish: r.plannedFinish,
      totalFloat: 0, freeFloat: 0, isCritical: false,
    });
  }
  return { byActivity, projectFinish: null, problems: [] };
}

function makeBootstrap(): BootstrapData {
  return {
    project: { id: "p", name: "P", number: null, project_start: "2026-05-01",
      data_date: null, default_calendar_id: "c", critical_float_threshold: 0,
      comment_visibility_default: "internal" },
    calendars: [], calendarExceptions: [], wbsNodes: [],
    activities: [act({ id: "A1", name: "Mobilize" }), act({ id: "A2", name: "Pour" })],
    dependencies: [], constraints: [], comments: [], history: [],
    lookaheads: [lookahead()],
    lookaheadTasks: [
      task({ id: "T1", master_activity_id: "A1", name: "Mobilization crew", offset_start: 0, offset_finish: 0 }),
      task({ id: "T2", master_activity_id: null, name: "Site cleanup",
        start_date: "2026-05-15", finish_date: "2026-05-15" }),
    ],
    users: {},
  };
}

function Wrap({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("LookaheadView", () => {
  it("renders both tasks of the selected lookahead with resolved dates", () => {
    const bootstrap = makeBootstrap();
    const ix = indexed({ id: "A1", plannedStart: "2026-05-06", plannedFinish: "2026-05-10" });
    render(
      <Wrap>
        <LookaheadView bootstrap={bootstrap} indexed={ix} projectId="p" companies={[]} />
      </Wrap>,
    );
    expect(screen.getByText("Mobilization crew")).toBeInTheDocument();
    expect(screen.getByText("Site cleanup")).toBeInTheDocument();
    expect(screen.getByText("2026-05-06")).toBeInTheDocument();
    expect(screen.getAllByText("2026-05-15")[0]).toBeInTheDocument();
  });

  it("shows the '+ New Lookahead' button", () => {
    const bootstrap = makeBootstrap();
    const ix = indexed();
    render(
      <Wrap>
        <LookaheadView bootstrap={bootstrap} indexed={ix} projectId="p" companies={[]} />
      </Wrap>,
    );
    expect(screen.getByRole("button", { name: /New Lookahead/ })).toBeInTheDocument();
  });

  it("shows the '+ Add Task' button when a lookahead is selected", () => {
    const bootstrap = makeBootstrap();
    const ix = indexed();
    render(
      <Wrap>
        <LookaheadView bootstrap={bootstrap} indexed={ix} projectId="p" companies={[]} />
      </Wrap>,
    );
    expect(screen.getByRole("button", { name: /Add Task/ })).toBeInTheDocument();
  });
});
