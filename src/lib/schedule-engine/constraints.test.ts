import { describe, expect, it } from "vitest";
import { applyForwardConstraint, applyBackwardConstraint } from "./constraints";
import type { Calendar } from "./types";

const week: Calendar = { id: "w", workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] };

describe("applyForwardConstraint", () => {
  it("returns the logic date unchanged when there is no constraint", () => {
    const r = applyForwardConstraint("2026-06-01", 3, undefined, week);
    expect(r).toEqual({ earlyStart: "2026-06-01", violated: false });
  });
  it("SNET raises ES to the constraint date", () => {
    const r = applyForwardConstraint("2026-06-01", 3, { type: "SNET", date: "2026-06-04" }, week);
    expect(r.earlyStart).toBe("2026-06-04");
  });
  it("SNET does not lower ES below the logic date", () => {
    const r = applyForwardConstraint("2026-06-10", 3, { type: "SNET", date: "2026-06-04" }, week);
    expect(r.earlyStart).toBe("2026-06-10");
  });
  it("FNET raises ES so EF is no earlier than the constraint date", () => {
    // EF >= 2026-06-12; duration 3 => ES >= subtract 3 working days = 2026-06-09
    const r = applyForwardConstraint("2026-06-01", 3, { type: "FNET", date: "2026-06-12" }, week);
    expect(r.earlyStart).toBe("2026-06-09");
  });
  it("MSO pins ES later when logic allows", () => {
    const r = applyForwardConstraint("2026-06-01", 3, { type: "MSO", date: "2026-06-05" }, week);
    expect(r).toEqual({ earlyStart: "2026-06-05", violated: false });
  });
  it("MSO is violated when logic forces a later start", () => {
    const r = applyForwardConstraint("2026-06-10", 3, { type: "MSO", date: "2026-06-05" }, week);
    expect(r).toEqual({ earlyStart: "2026-06-10", violated: true });
  });
  it("ALAP and backward-only constraints are inert in the forward pass", () => {
    const r = applyForwardConstraint("2026-06-01", 3, { type: "SNLT", date: "2026-06-04" }, week);
    expect(r).toEqual({ earlyStart: "2026-06-01", violated: false });
  });
});

describe("applyBackwardConstraint", () => {
  it("returns the logic date unchanged when there is no constraint", () => {
    const r = applyBackwardConstraint("2026-06-12", 3, undefined, week);
    expect(r).toEqual({ lateFinish: "2026-06-12", violated: false });
  });
  it("FNLT lowers LF to the constraint date", () => {
    const r = applyBackwardConstraint("2026-06-20", 3, { type: "FNLT", date: "2026-06-12" }, week);
    expect(r.lateFinish).toBe("2026-06-12");
  });
  it("SNLT lowers LF so LS is no later than the constraint date", () => {
    // LS <= 2026-06-08; duration 3 => LF <= add 3 working days = 2026-06-11
    const r = applyBackwardConstraint("2026-06-20", 3, { type: "SNLT", date: "2026-06-08" }, week);
    expect(r.lateFinish).toBe("2026-06-11");
  });
  it("MFO pins LF earlier when logic allows", () => {
    const r = applyBackwardConstraint("2026-06-20", 3, { type: "MFO", date: "2026-06-12" }, week);
    expect(r).toEqual({ lateFinish: "2026-06-12", violated: false });
  });
  it("MFO is violated when logic forces an earlier finish", () => {
    const r = applyBackwardConstraint("2026-06-05", 3, { type: "MFO", date: "2026-06-12" }, week);
    expect(r).toEqual({ lateFinish: "2026-06-05", violated: true });
  });
});
