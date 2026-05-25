import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SessionNoteModal } from "./SessionNoteModal";

afterEach(cleanup);

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
