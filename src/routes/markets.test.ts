import { describe, expect, test } from "bun:test";
import { createMarketsRouter } from "./markets.js";
import type { MarketsService, GatewayMarket } from "../lib/markets.js";
import type { AvailabilityService, MarketAvailability } from "../lib/availability.js";
import {
  createRateLimiter,
  createUnpaidRateLimitMiddleware,
} from "../lib/rateLimit.js";
import { ok, err, type Result } from "../lib/result.js";

// A fresh permissive limiter per router: these tests make far fewer requests
// than one window allows, so the middleware never interferes. Without a Bun
// server every request shares the "unknown" client key, which is exactly what
// the exhaustion test below relies on.
const buildPermissiveRateLimit = () =>
  createUnpaidRateLimitMiddleware(createRateLimiter(), false);

const marketWithHosts: GatewayMarket = {
  address: "9MGKqixvtLJgL46Bp38ZrD3MxTMRt57VL3rQtQY64zj4",
  slug: "gpu-a",
  name: "GPU A",
  usdRewardPerHour: 0.5,
  networkFeePercentage: 10,
  type: "COMMUNITY",
};
const marketWithoutData: GatewayMarket = {
  address: "5XiAbifHtRQt3w1JSBGtMtoFmVMX23vdVciJpA2vyFp2",
  slug: "gpu-b",
  name: "GPU B",
  usdRewardPerHour: 1,
  networkFeePercentage: 10,
  type: "PREMIUM",
};

const buildMarketsService = (
  listImplementation: () => Promise<Result<GatewayMarket[]>>,
): MarketsService => ({
  listMarkets: listImplementation,
  resolveMarket: async () => err("resolveMarket is not exercised by these tests"),
});

const buildAvailabilityService = (
  listImplementation: () => Promise<Result<Map<string, MarketAvailability>>>,
): AvailabilityService => ({
  listAvailability: listImplementation,
  getMarketAvailability: async (address) => {
    const allAvailability = await listImplementation();
    if (!allAvailability.ok) {
      return allAvailability;
    }
    const found = allAvailability.value.get(address);
    return found ? ok(found) : err(`market ${address} not found`);
  },
});

interface MarketsResponseBody {
  markets: Array<{
    slug: string;
    availability: { status: string; nodes_available: number; jobs_queued: number };
  }>;
}

describe("createMarketsRouter", () => {
  test("attaches availability per market and marks missing ones unknown", async () => {
    const marketsService = buildMarketsService(async () => ok([marketWithHosts, marketWithoutData]));
    const availabilityService = buildAvailabilityService(async () =>
      ok(
        new Map<string, MarketAvailability>([
          [marketWithHosts.address, { status: "nodes_available", nodesAvailable: 2, jobsQueued: 0 }],
        ]),
      ),
    );
    const router = createMarketsRouter(marketsService, availabilityService, buildPermissiveRateLimit());
    const response = await router.request("/");
    expect(response.status).toBe(200);
    const body = (await response.json()) as MarketsResponseBody;
    const available = body.markets.find((market) => market.slug === "gpu-a");
    const missing = body.markets.find((market) => market.slug === "gpu-b");
    expect(available?.availability.status).toBe("nodes_available");
    expect(available?.availability.nodes_available).toBe(2);
    // A market absent from the on-chain set is reported honestly, not guessed.
    expect(missing?.availability.status).toBe("unknown");
  });

  test("degrades every market to unknown when the queue read fails", async () => {
    const marketsService = buildMarketsService(async () => ok([marketWithHosts]));
    const availabilityService = buildAvailabilityService(async () => err("rpc down"));
    const router = createMarketsRouter(marketsService, availabilityService, buildPermissiveRateLimit());
    const response = await router.request("/");
    expect(response.status).toBe(200);
    const body = (await response.json()) as MarketsResponseBody;
    expect(body.markets[0]?.availability.status).toBe("unknown");
  });

  test("returns 502 when the markets API is unreachable", async () => {
    const marketsService = buildMarketsService(async () => err("markets API unreachable: boom"));
    const availabilityService = buildAvailabilityService(async () => ok(new Map()));
    const router = createMarketsRouter(marketsService, availabilityService, buildPermissiveRateLimit());
    const response = await router.request("/");
    expect(response.status).toBe(502);
  });

  test("refuses with 429 and a retry-after header once the rate limit is spent", async () => {
    const marketsService = buildMarketsService(async () => ok([marketWithHosts]));
    const availabilityService = buildAvailabilityService(async () => ok(new Map()));
    // One request per window; the second must be refused before the handler runs.
    const router = createMarketsRouter(
      marketsService,
      availabilityService,
      createUnpaidRateLimitMiddleware(createRateLimiter(1), false),
    );
    expect((await router.request("/")).status).toBe(200);
    const refused = await router.request("/");
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    const body = (await refused.json()) as { error: string };
    expect(body.error).toContain("too many unpaid requests");
  });
});
