import { describe, it, expect } from "vitest";
import { buildUserLookup } from "./bootstrap";

describe("buildUserLookup", () => {
  it("maps full_name to display_name and pre-computes color", () => {
    const rows = [
      { id: "u1", company_id: "c1", full_name: "Tanner Frenkel" },
      { id: "u2", company_id: "c2", full_name: "Sub Sam" },
    ];
    const lookup = buildUserLookup(rows);
    expect(lookup.u1.display_name).toBe("Tanner Frenkel");
    expect(lookup.u2.display_name).toBe("Sub Sam");
    expect(lookup.u1.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(lookup.u1.color).toBe(lookup.u1.color); // deterministic
  });

  it("returns an empty record when no rows", () => {
    expect(buildUserLookup([])).toEqual({});
  });
});
