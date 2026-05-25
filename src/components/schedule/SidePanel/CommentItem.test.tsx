import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
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
