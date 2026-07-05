import { describe, expect, test } from "bun:test";
import { computeRentQuote } from "./pricing.js";
import type { GatewayMarket } from "./markets.js";

const buildMarket = (usdRewardPerHour: number): GatewayMarket => ({
  address: "9MGKqixvtLJgL46Bp38ZrD3MxTMRt57VL3rQtQY64zj4",
  slug: "test-market",
  name: "Test Market",
  usdRewardPerHour,
  networkFeePercentage: 10,
  type: "COMMUNITY",
});

describe("computeRentQuote", () => {
  test("prices one hour at the exact hourly rate", () => {
    // 0.01 USD/hour for 60 minutes is 0.01 USD = 10000 atomic units.
    const quote = computeRentQuote(buildMarket(0.01), 60);
    expect(quote.ok).toBe(true);
    if (quote.ok) {
      expect(quote.value.amountAtomic).toBe("10000");
      expect(quote.value.amountUsd).toBe(0.01);
    }
  });

  test("matches the live market rate observed in the README capture", () => {
    // nvidia-3060 at 0.0436 USD/hour for 60 minutes was quoted 43600.
    const quote = computeRentQuote(buildMarket(0.0436), 60);
    expect(quote.ok).toBe(true);
    if (quote.ok) {
      expect(quote.value.amountAtomic).toBe("43600");
    }
  });

  test("prorates a partial hour", () => {
    // 1.36 USD/hour for 90 minutes is 2.04 USD.
    const quote = computeRentQuote(buildMarket(1.36), 90);
    expect(quote.ok).toBe(true);
    if (quote.ok) {
      expect(quote.value.amountAtomic).toBe("2040000");
    }
  });

  test("rounds up so a rounding step never undercharges", () => {
    // 0.01 USD/hour for 1 minute is 166.66 micro-USD, ceiling 167.
    const quote = computeRentQuote(buildMarket(0.01), 1);
    expect(quote.ok).toBe(true);
    if (quote.ok) {
      expect(quote.value.amountAtomic).toBe("167");
    }
  });

  test("rejects a zero-priced market", () => {
    const quote = computeRentQuote(buildMarket(0), 60);
    expect(quote.ok).toBe(false);
  });

  test("rejects a negative-priced market", () => {
    const quote = computeRentQuote(buildMarket(-1), 60);
    expect(quote.ok).toBe(false);
  });

  test("survives 24 hours on the most expensive observed market without float drift", () => {
    // 1 USD/hour for 1440 minutes is exactly 24 USD.
    const quote = computeRentQuote(buildMarket(1), 1440);
    expect(quote.ok).toBe(true);
    if (quote.ok) {
      expect(quote.value.amountAtomic).toBe("24000000");
      expect(quote.value.amountUsd).toBe(24);
    }
  });
});
