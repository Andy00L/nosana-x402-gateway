import { describe, expect, test } from "bun:test";
import { createMarketsService, type MarketsApiSource } from "./markets.js";

const WELL_FORMED_MARKET = {
  address: "9MGKqixvtLJgL46Bp38ZrD3MxTMRt57VL3rQtQY64zj4",
  slug: "test-market",
  name: "Test Market",
  usd_reward_per_hour: 0.01,
  network_fee_percentage: 10,
  type: "COMMUNITY",
};

const buildStubSource = (
  listImplementation: () => Promise<Record<string, unknown>[]>,
): { source: MarketsApiSource; callCount: () => number } => {
  let calls = 0;
  return {
    source: {
      api: {
        markets: {
          list: () => {
            calls += 1;
            return listImplementation();
          },
        },
      },
    },
    callCount: () => calls,
  };
};

describe("createMarketsService", () => {
  test("parses well-formed markets and skips malformed ones", async () => {
    const { source } = buildStubSource(async () => [
      WELL_FORMED_MARKET,
      { address: "missing-everything-else" },
    ]);
    const markets = await createMarketsService(source).listMarkets();
    expect(markets.ok).toBe(true);
    if (markets.ok) {
      expect(markets.value).toHaveLength(1);
      expect(markets.value[0]?.slug).toBe("test-market");
      expect(markets.value[0]?.usdRewardPerHour).toBe(0.01);
    }
  });

  test("fails when no market parses", async () => {
    const { source } = buildStubSource(async () => [{ junk: true }]);
    const markets = await createMarketsService(source).listMarkets();
    expect(markets.ok).toBe(false);
  });

  test("resolves a market by slug and by address", async () => {
    const { source } = buildStubSource(async () => [WELL_FORMED_MARKET]);
    const marketsService = createMarketsService(source);
    const bySlug = await marketsService.resolveMarket("test-market");
    expect(bySlug.ok).toBe(true);
    const byAddress = await marketsService.resolveMarket(WELL_FORMED_MARKET.address);
    expect(byAddress.ok).toBe(true);
  });

  test("rejects an unknown market with an actionable reason", async () => {
    const { source } = buildStubSource(async () => [WELL_FORMED_MARKET]);
    const resolution = await createMarketsService(source).resolveMarket("nope");
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.reason).toContain("GET /markets");
    }
  });

  test("reports an unreachable markets API as an upstream failure", async () => {
    const { source } = buildStubSource(async () => {
      throw new Error("connection refused");
    });
    const markets = await createMarketsService(source).listMarkets();
    expect(markets.ok).toBe(false);
    if (!markets.ok) {
      expect(markets.reason).toContain("markets API unreachable");
    }
  });

  test("serves the second call from cache inside the TTL", async () => {
    const { source, callCount } = buildStubSource(async () => [WELL_FORMED_MARKET]);
    const marketsService = createMarketsService(source);
    await marketsService.listMarkets();
    await marketsService.listMarkets();
    expect(callCount()).toBe(1);
  });
});
