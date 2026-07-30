import { describe, expect, test } from "bun:test";
import { createRateLimiter } from "./rateLimit.js";

// Deterministic clock: every check passes an explicit nowMs so no test depends
// on wall time.
const WINDOW_MS = 60_000;
const START_MS = 1_000_000;

describe("createRateLimiter", () => {
  test("allows requests up to the window limit, then refuses", () => {
    const limiter = createRateLimiter(3, WINDOW_MS);
    expect(limiter.check("client-a", START_MS).allowed).toBe(true);
    expect(limiter.check("client-a", START_MS + 10).allowed).toBe(true);
    expect(limiter.check("client-a", START_MS + 20).allowed).toBe(true);
    const refused = limiter.check("client-a", START_MS + 30);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  test("a refusal reports the seconds until the window resets", () => {
    const limiter = createRateLimiter(1, WINDOW_MS);
    limiter.check("client-a", START_MS);
    // 45s into a 60s window: 15s remain.
    const refused = limiter.check("client-a", START_MS + 45_000);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(15);
  });

  test("the window resets after it elapses", () => {
    const limiter = createRateLimiter(1, WINDOW_MS);
    expect(limiter.check("client-a", START_MS).allowed).toBe(true);
    expect(limiter.check("client-a", START_MS + 1).allowed).toBe(false);
    expect(limiter.check("client-a", START_MS + WINDOW_MS).allowed).toBe(true);
  });

  test("clients are limited independently", () => {
    const limiter = createRateLimiter(1, WINDOW_MS);
    expect(limiter.check("client-a", START_MS).allowed).toBe(true);
    expect(limiter.check("client-a", START_MS + 1).allowed).toBe(false);
    // A different client is untouched by client-a's exhausted window.
    expect(limiter.check("client-b", START_MS + 2).allowed).toBe(true);
  });

  test("memory stays bounded when many clients appear", () => {
    const limiter = createRateLimiter(1, WINDOW_MS);
    // Far above MAX_TRACKED_CLIENTS (10_000): the map must prune or clear
    // instead of growing without bound, and checks must keep working after.
    for (let clientIndex = 0; clientIndex < 25_000; clientIndex += 1) {
      const decision = limiter.check(`client-${clientIndex}`, START_MS + clientIndex);
      expect(decision.allowed).toBe(true);
    }
    expect(limiter.check("client-after-prune", START_MS + 25_000).allowed).toBe(true);
  });
});
