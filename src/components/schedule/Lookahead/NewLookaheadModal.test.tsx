import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewLookaheadModal } from "./NewLookaheadModal";

describe("NewLookaheadModal", () => {
  it("submit is disabled when name is empty", () => {
    render(<NewLookaheadModal onSubmit={vi.fn()} onClose={vi.fn()} />);
    const submit = screen.getByRole("button", { name: /Create/ });
    expect(submit).toBeDisabled();
  });

  it("submit is disabled when window_start is after window_end", async () => {
    const user = userEvent.setup();
    render(<NewLookaheadModal onSubmit={vi.fn()} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText(/Name/), "Test");
    fireEvent.change(screen.getByLabelText(/Window start/), { target: { value: "2026-05-28" } });
    fireEvent.change(screen.getByLabelText(/Window end/), { target: { value: "2026-05-01" } });
    expect(screen.getByRole("button", { name: /Create/ })).toBeDisabled();
  });

  it("calls onSubmit with the form values when valid", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<NewLookaheadModal onSubmit={onSubmit} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText(/Name/), "Test LA");
    fireEvent.change(screen.getByLabelText(/Window start/), { target: { value: "2026-05-01" } });
    fireEvent.change(screen.getByLabelText(/Window end/), { target: { value: "2026-05-28" } });
    await user.type(screen.getByLabelText(/Type/), "weekly");
    await user.click(screen.getByRole("button", { name: /Create/ }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Test LA",
      windowStart: "2026-05-01",
      windowEnd: "2026-05-28",
      type: "weekly",
    });
  });

  it("calls onClose when the Cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<NewLookaheadModal onSubmit={vi.fn()} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
