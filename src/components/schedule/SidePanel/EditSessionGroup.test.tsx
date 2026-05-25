import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { EditSessionGroup } from "./EditSessionGroup";
import type { DbActivityHistory, UserLookupEntry } from "@/lib/schedule/types";

afterEach(cleanup);

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
    expect(screen.queryByText(/old1/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /expand/i }));
    expect(screen.getByText(/old1/)).toBeInTheDocument();
    expect(screen.getByText(/old2/)).toBeInTheDocument();
  });
});
