import { describe, expect, test } from "bun:test";
import { evaluateCreditsCoverage } from "./provisioning.js";

// 1 USD cent = 10^4 USDC atomic units. So 100 cents (1 USD) = 1_000_000 atomic.
describe("evaluateCreditsCoverage", () => {
  test("accepts a rental the balance covers with no floor", () => {
    const decision = evaluateCreditsCoverage({
      availableCents: 100, // 1_000_000 atomic
      quoteAmountAtomic: "43600",
      floorCents: 0,
    });
    expect(decision.ok).toBe(true);
  });

  test("accepts a rental that spends the balance exactly to zero", () => {
    const decision = evaluateCreditsCoverage({
      availableCents: 1, // 10_000 atomic
      quoteAmountAtomic: "10000",
      floorCents: 0,
    });
    expect(decision.ok).toBe(true);
  });

  test("refuses a rental one atomic unit over the balance", () => {
    const decision = evaluateCreditsCoverage({
      availableCents: 1, // 10_000 atomic
      quoteAmountAtomic: "10001",
      floorCents: 0,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toContain("cannot cover this rental");
    }
  });

  test("refuses when settling would breach the float floor", () => {
    // 100 cents available, 50-cent floor: only 50 cents (500_000 atomic)
    // is spendable. A 600_000 atomic rental must be refused.
    const decision = evaluateCreditsCoverage({
      availableCents: 100,
      quoteAmountAtomic: "600000",
      floorCents: 50,
    });
    expect(decision.ok).toBe(false);
  });

  test("accepts a rental that lands exactly on the floor", () => {
    const decision = evaluateCreditsCoverage({
      availableCents: 100,
      quoteAmountAtomic: "500000", // leaves exactly the 50-cent floor
      floorCents: 50,
    });
    expect(decision.ok).toBe(true);
  });

  test("treats a negative balance as zero and refuses", () => {
    const decision = evaluateCreditsCoverage({
      availableCents: -5,
      quoteAmountAtomic: "1",
      floorCents: 0,
    });
    expect(decision.ok).toBe(false);
  });
});
