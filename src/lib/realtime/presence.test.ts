import { describe, expect, it } from "vitest";
import { deriveColor, PRESENCE_PALETTE } from "./presence";

describe("deriveColor", () => {
  it("returns a palette color for any string", () => {
    const c = deriveColor("11111111-1111-1111-1111-111111111111");
    expect(PRESENCE_PALETTE).toContain(c);
  });

  it("is deterministic — same input → same color", () => {
    expect(deriveColor("foo")).toBe(deriveColor("foo"));
    expect(deriveColor("00000000-0000-0000-0000-000000000001"))
      .toBe(deriveColor("00000000-0000-0000-0000-000000000001"));
  });

  it("spreads across the palette for varying inputs", () => {
    const colors = new Set<string>();
    for (let i = 0; i < 50; i++) colors.add(deriveColor(`user-${i}`));
    expect(colors.size).toBeGreaterThanOrEqual(4);  // at least half the 8-color palette
  });
});
