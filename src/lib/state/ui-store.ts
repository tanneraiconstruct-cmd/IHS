import { create } from "zustand";

export type ScheduleView = "gantt" | "list" | "calendar" | "lookahead";
export type Mode = "view" | "edit";
export type Zoom = "day" | "week" | "month";
export type VisibilityFilter = "all" | "internal" | "shared";

export interface Filters {
  criticalOnly: boolean;
  trade: string | null;
  responsibleCompanyId: string | null;
}

interface UiState {
  view: ScheduleView;
  mode: Mode;
  zoom: Zoom;
  selectedActivityId: string | null;
  editSessionId: string | null;
  filters: Filters;
  visibilityFilter: VisibilityFilter;
}

interface UiActions {
  setView: (view: ScheduleView) => void;
  setZoom: (zoom: Zoom) => void;
  select: (id: string | null) => void;
  enterEditMode: () => void;
  exitEditMode: () => void;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  setVisibilityFilter: (v: VisibilityFilter) => void;
}

const initialState: UiState = {
  view: "gantt",
  mode: "view",
  zoom: "week",
  selectedActivityId: null,
  editSessionId: null,
  filters: { criticalOnly: false, trade: null, responsibleCompanyId: null },
  visibilityFilter: "all",
};

export const useUiStore = create<UiState & UiActions>((set) => ({
  ...initialState,
  setView: (view) => set({ view }),
  setZoom: (zoom) => set({ zoom }),
  select: (id) => set({ selectedActivityId: id }),
  enterEditMode: () =>
    set({ mode: "edit", editSessionId: crypto.randomUUID() }),
  exitEditMode: () => set({ mode: "view", editSessionId: null }),
  setFilter: (key, value) =>
    set((s) => ({ filters: { ...s.filters, [key]: value } })),
  setVisibilityFilter: (v) => set({ visibilityFilter: v }),
}));

// Expose the initial state for test resets.
// Merges initial state values over current store (which holds actions) so
// setState(..., true) replaces the whole store but keeps actions intact.
(useUiStore as unknown as { getInitialState: () => UiState & UiActions }).getInitialState =
  () => ({ ...useUiStore.getState(), ...structuredClone(initialState) });
