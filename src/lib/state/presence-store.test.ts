import { beforeEach, describe, expect, it } from "vitest";
import { usePresenceStore } from "./presence-store";

beforeEach(() => {
  usePresenceStore.setState({ online: {}, connection: "connecting" });
});

describe("presence-store", () => {
  it("setOnline flattens Supabase's per-key arrays", () => {
    usePresenceStore.getState().setOnline({
      "u1": [{ userId: "u1", displayName: "Alice", color: "#000", editMode: false, joinedAt: "1" }],
      "u2": [{ userId: "u2", displayName: "Bob", color: "#111", editMode: true, joinedAt: "2" }],
    });
    const online = usePresenceStore.getState().online;
    expect(Object.keys(online).sort()).toEqual(["u1", "u2"]);
    expect(online["u2"].editMode).toBe(true);
  });

  it("setOnline ignores empty arrays from a stale key", () => {
    usePresenceStore.getState().setOnline({
      "u1": [{ userId: "u1", displayName: "Alice", color: "#000", editMode: false, joinedAt: "1" }],
      "u2": [],
    });
    expect(Object.keys(usePresenceStore.getState().online)).toEqual(["u1"]);
  });

  it("setConnection updates connection status", () => {
    usePresenceStore.getState().setConnection("live");
    expect(usePresenceStore.getState().connection).toBe("live");
    usePresenceStore.getState().setConnection("offline");
    expect(usePresenceStore.getState().connection).toBe("offline");
  });
});
