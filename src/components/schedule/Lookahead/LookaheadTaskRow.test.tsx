import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LookaheadTaskRow } from "./LookaheadTaskRow";
import type { DbActivity, DbLookaheadTask } from "@/lib/schedule/types";

// `companies` is not in the bootstrap; use a minimal shape locally.
type CompanyMin = { id: string; name: string };

function task(over: Partial<DbLookaheadTask> = {}): DbLookaheadTask {
  return {
    id: over.id ?? "T1", lookahead_id: "L1", master_activity_id: null, name: "T1",
    offset_start: null, offset_finish: null, start_date: null, finish_date: null,
    crew: null, responsible_company_id: null, status: "not_started",
    percent_complete: 0, constraints_cleared: false, readiness_notes: null,
    deleted_at: null, ...over,
  };
}

function activity(over: Partial<DbActivity> = {}): DbActivity {
  return {
    id: over.id ?? "A1", project_id: "p", wbs_node_id: null, name: "Mobilize",
    activity_type: "task", original_duration: 1, remaining_duration: 1,
    calendar_id: null, actual_start: null, actual_finish: null,
    percent_complete: 0, responsible_company_id: null,
    early_start: null, early_finish: null, late_start: null, late_finish: null,
    planned_start: null, planned_finish: null, total_float: null, free_float: null,
    is_critical: false, version: 1, deleted_at: null, ...over,
  };
}

const baseProps = {
  masters: [activity({ id: "A1", name: "Mobilize" }), activity({ id: "A2", name: "Pour Foundations" })],
  companies: [{ id: "co-1", name: "IHS" }, { id: "co-2", name: "Acme Concrete" }] as CompanyMin[],
  computedStart: "2026-05-06",
  computedFinish: "2026-05-10",
  onUpdate: vi.fn(),
  onDelete: vi.fn(),
};

describe("LookaheadTaskRow — visibility", () => {
  it("hides offset cells for a detached task", () => {
    render(<table><tbody><LookaheadTaskRow {...baseProps} task={task({ master_activity_id: null })} /></tbody></table>);
    expect(screen.queryByLabelText(/offset start/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/offset finish/i)).not.toBeInTheDocument();
  });

  it("shows offset cells (read-only labels until clicked) for a master-linked task", () => {
    render(<table><tbody><LookaheadTaskRow {...baseProps} task={task({ master_activity_id: "A1", offset_start: 0, offset_finish: 0 })} /></tbody></table>);
    expect(screen.getAllByText("0d").length).toBeGreaterThan(0);
  });
});

describe("LookaheadTaskRow — inline edit", () => {
  it("commits a name change on Enter", async () => {
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    render(<table><tbody><LookaheadTaskRow {...baseProps} onUpdate={onUpdate} task={task({ id: "T1", name: "Old" })} /></tbody></table>);
    await user.dblClick(screen.getByText("Old"));
    const input = screen.getByDisplayValue("Old");
    await user.clear(input);
    await user.type(input, "New{Enter}");
    expect(onUpdate).toHaveBeenCalledWith("T1", { name: "New" });
  });

  it("reverts to the prior value on Escape", async () => {
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    render(<table><tbody><LookaheadTaskRow {...baseProps} onUpdate={onUpdate} task={task({ name: "Old" })} /></tbody></table>);
    await user.dblClick(screen.getByText("Old"));
    const input = screen.getByDisplayValue("Old");
    await user.clear(input);
    await user.type(input, "New{Escape}");
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText("Old")).toBeInTheDocument();
  });

  it("commits a % complete change on blur", async () => {
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    render(<table><tbody><LookaheadTaskRow {...baseProps} onUpdate={onUpdate} task={task({ id: "T1", percent_complete: 0 })} /></tbody></table>);
    await user.dblClick(screen.getByText("0%"));
    const input = screen.getByDisplayValue("0");
    await user.clear(input);
    await user.type(input, "50");
    fireEvent.blur(input);
    expect(onUpdate).toHaveBeenCalledWith("T1", { percent_complete: 50 });
  });

  it("calls onDelete when the delete button is clicked", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<table><tbody><LookaheadTaskRow {...baseProps} onDelete={onDelete} task={task({ id: "T1" })} /></tbody></table>);
    await user.click(screen.getByRole("button", { name: /Delete/ }));
    expect(onDelete).toHaveBeenCalledWith("T1");
  });
});
