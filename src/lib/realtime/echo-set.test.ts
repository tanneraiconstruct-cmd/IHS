import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetForTests, consumeEcho, markInflight } from "./echo-set";

beforeEach(() => {
  _resetForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("echo-set", () => {
  it("returns true and removes the id when consumed", () => {
    markInflight("abc");
    expect(consumeEcho("abc")).toBe(true);
    expect(consumeEcho("abc")).toBe(false);  // already removed
  });

  it("returns false for an unknown id", () => {
    expect(consumeEcho("never-marked")).toBe(false);
  });

  it("treats an entry past its TTL as not-in-flight", () => {
    markInflight("abc");
    vi.advanceTimersByTime(31_000);  // past 30s TTL
    expect(consumeEcho("abc")).toBe(false);
  });

  it("keeps an entry within its TTL", () => {
    markInflight("abc");
    vi.advanceTimersByTime(29_000);
    expect(consumeEcho("abc")).toBe(true);
  });

  it("_resetForTests clears all entries", () => {
    markInflight("a"); markInflight("b");
    _resetForTests();
    expect(consumeEcho("a")).toBe(false);
    expect(consumeEcho("b")).toBe(false);
  });
});
