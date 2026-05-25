import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePresenceStore } from "@/lib/state/presence-store";
import { PresenceBar } from "./PresenceBar";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  usePresenceStore.setState({ online: {}, connection: "connecting" });
});

function setOnline(users: Array<Partial<{ userId: string; displayName: string; color: string; editMode: boolean }>>) {
  const online: Record<string, ReturnType<typeof usePresenceStore.getState>["online"][string]> = {};
  for (const u of users) {
    const userId = u.userId ?? `u-${Math.random()}`;
    online[userId] = {
      userId,
      displayName: u.displayName ?? "X",
      color: u.color ?? "#000000",
      editMode: u.editMode ?? false,
      joinedAt: "2026-01-01T00:00:00Z",
    };
  }
  usePresenceStore.setState({ online });
}

describe("<PresenceBar />", () => {
  it("renders one circle per online user up to 5", () => {
    setOnline([
      { displayName: "Alice" },
      { displayName: "Bob" },
      { displayName: "Carol" },
    ]);
    render(<PresenceBar currentUserId="u-self" />);
    expect(screen.getAllByTestId("presence-avatar")).toHaveLength(3);
  });

  it("shows an overflow chip when more than 5 users are online", () => {
    setOnline([
      { displayName: "A" }, { displayName: "B" }, { displayName: "C" },
      { displayName: "D" }, { displayName: "E" }, { displayName: "F" },
      { displayName: "G" },
    ]);
    render(<PresenceBar currentUserId="u-self" />);
    expect(screen.getAllByTestId("presence-avatar")).toHaveLength(5);
    expect(screen.getByTestId("presence-overflow")).toHaveTextContent("+2");
  });

  it("renders an editing indicator for edit-mode users", () => {
    setOnline([
      { userId: "u1", displayName: "Editor", editMode: true },
      { userId: "u2", displayName: "Viewer", editMode: false },
    ]);
    render(<PresenceBar currentUserId="u-self" />);
    const editing = screen.getAllByTestId("presence-avatar").filter((el) =>
      el.getAttribute("data-editing") === "true");
    expect(editing).toHaveLength(1);
    expect(editing[0]).toHaveAttribute("aria-label", expect.stringMatching(/Editor.*Editing/));
  });

  it("renders the connection dot reflecting store status", () => {
    usePresenceStore.setState({ connection: "offline", online: {} });
    render(<PresenceBar currentUserId="u-self" />);
    expect(screen.getByTestId("presence-connection")).toHaveAttribute("data-status", "offline");
  });
});
