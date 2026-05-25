import { describe, it, expect, beforeEach } from "vitest";
import { useUiStore } from "./ui-store";

describe("useUiStore", () => {
  beforeEach(() => {
    useUiStore.setState(useUiStore.getInitialState(), true);
  });

  it("starts in view mode with no selection and gantt view", () => {
    const s = useUiStore.getState();
    expect(s.mode).toBe("view");
    expect(s.view).toBe("gantt");
    expect(s.selectedActivityId).toBeNull();
    expect(s.editSessionId).toBeNull();
  });

  it("enterEditMode sets mode and generates an editSessionId", () => {
    useUiStore.getState().enterEditMode();
    const s = useUiStore.getState();
    expect(s.mode).toBe("edit");
    expect(s.editSessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("exitEditMode clears mode and editSessionId", () => {
    useUiStore.getState().enterEditMode();
    useUiStore.getState().exitEditMode();
    const s = useUiStore.getState();
    expect(s.mode).toBe("view");
    expect(s.editSessionId).toBeNull();
  });

  it("setView preserves selectedActivityId and filters", () => {
    useUiStore.getState().select("act-1");
    useUiStore.getState().setFilter("criticalOnly", true);
    useUiStore.getState().setView("calendar");
    const s = useUiStore.getState();
    expect(s.view).toBe("calendar");
    expect(s.selectedActivityId).toBe("act-1");
    expect(s.filters.criticalOnly).toBe(true);
  });

  it("starts with visibilityFilter = 'all' and setVisibilityFilter updates it", () => {
    const s = useUiStore.getState();
    expect(s.visibilityFilter).toBe("all");
    s.setVisibilityFilter("internal");
    expect(useUiStore.getState().visibilityFilter).toBe("internal");
    s.setVisibilityFilter("shared");
    expect(useUiStore.getState().visibilityFilter).toBe("shared");
  });
});
