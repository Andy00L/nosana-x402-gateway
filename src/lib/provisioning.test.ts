import { describe, expect, test } from "bun:test";
import { evaluateCreditsCoverage } from "./provisioning.js";

// Balance is USD dollars. 1 USD = 1_000_000 USDC atomic units, 1 cent = 10_000.
describe("evaluateCreditsCoverage", () => {
  test("accepts a rental the balance covers with no floor", () => {
    const decision = evaluateCreditsCoverage({
      availableUsd: 1, // 1_000_000 atomic
      quoteAmountAtomic: "43600",
      floorCents: 0,
    });
    expect(decision.ok).toBe(true);
  });

  test("accepts a rental that spends the balance exactly to zero", () => {
    const decision = evaluateCreditsCoverage({
      availableUsd: 0.01, // 1 cent = 10_000 atomic
      quoteAmountAtomic: "10000",
      floorCents: 0,
    });
    expect(decision.ok).toBe(true);
  });

  test("refuses a rental one atomic unit over the balance", () => {
    const decision = evaluateCreditsCoverage({
      availableUsd: 0.01, // 10_000 atomic
      quoteAmountAtomic: "10001",
      floorCents: 0,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toContain("cannot cover this rental");
    }
  });

  test("covers a realistic mainnet balance and a small rental", () => {
    // $50.13 available, a 1-hour nvidia-3060 rental at 43600 atomic ($0.0436).
    const decision = evaluateCreditsCoverage({
      availableUsd: 50.13,
      quoteAmountAtomic: "43600",
      floorCents: 0,
    });
    expect(decision.ok).toBe(true);
  });

  test("refuses when settling would breach the float floor", () => {
    // $1 available, 50-cent floor: only 50 cents (500_000 atomic) is spendable.
    const decision = evaluateCreditsCoverage({
      availableUsd: 1,
      quoteAmountAtomic: "600000",
      floorCents: 50,
    });
    expect(decision.ok).toBe(false);
  });

  test("accepts a rental that lands exactly on the floor", () => {
    const decision = evaluateCreditsCoverage({
      availableUsd: 1,
      quoteAmountAtomic: "500000", // leaves exactly the 50-cent floor
      floorCents: 50,
    });
    expect(decision.ok).toBe(true);
  });

  test("treats a negative balance as zero and refuses", () => {
    const decision = evaluateCreditsCoverage({
      availableUsd: -5,
      quoteAmountAtomic: "1",
      floorCents: 0,
    });
    expect(decision.ok).toBe(false);
  });
});
