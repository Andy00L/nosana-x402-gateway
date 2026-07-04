import type { NosanaClient } from "@nosana/kit";
import { type Result, ok, err } from "./result.js";

// Short cache so one burst of agent traffic does not hammer the markets API.
// Prices move with the NOS/USD rate; 60s is well inside the 300s quote window.
// In-memory and lost on restart, which is acceptable for a cache.
const MARKETS_CACHE_TTL_MS = 60_000;

// Market fields the gateway needs, parsed from the untyped API record
// (the kit types Market as Record<string, unknown>; field names verified
// against the live API on 2026-07-04, see docs/x402-execution-plan.md).
export interface GatewayMarket {
  readonly address: string;
  readonly slug: string;
  readonly name: string;
  readonly usdRewardPerHour: number;
  readonly networkFeePercentage: number;
  readonly type: string;
}

const parseMarketRecord = (record: Record<string, unknown>): Result<GatewayMarket> => {
  const { address, slug, name, usd_reward_per_hour, network_fee_percentage, type } = record;
  if (typeof address !== "string" || address.length === 0) {
    return err("market record has no string address");
  }
  if (typeof slug !== "string" || slug.length === 0) {
    return err(`market ${address} has no string slug`);
  }
  if (typeof name !== "string") {
    return err(`market ${address} has no string name`);
  }
  if (typeof usd_reward_per_hour !== "number" || !Number.isFinite(usd_reward_per_hour)) {
    return err(`market ${address} has no numeric usd_reward_per_hour`);
  }
  if (typeof network_fee_percentage !== "number" || !Number.isFinite(network_fee_percentage)) {
    return err(`market ${address} has no numeric network_fee_percentage`);
  }
  if (typeof type !== "string") {
    return err(`market ${address} has no string type`);
  }
  return ok({
    address,
    slug,
    name,
    usdRewardPerHour: usd_reward_per_hour,
    networkFeePercentage: network_fee_percentage,
    type,
  });
};

export interface MarketsService {
  listMarkets: () => Promise<Result<GatewayMarket[]>>;
  resolveMarket: (slugOrAddress: string) => Promise<Result<GatewayMarket>>;
}

export const createMarketsService = (nosanaClient: NosanaClient): MarketsService => {
  let marketsCache: { fetchedAtMs: number; markets: GatewayMarket[] } | null = null;

  const listMarkets = async (): Promise<Result<GatewayMarket[]>> => {
    const nowMs = Date.now();
    if (marketsCache && nowMs - marketsCache.fetchedAtMs < MARKETS_CACHE_TTL_MS) {
      return ok(marketsCache.markets);
    }
    let rawMarkets: Record<string, unknown>[];
    try {
      rawMarkets = await nosanaClient.api.markets.list();
    } catch (marketsApiError) {
      const message =
        marketsApiError instanceof Error ? marketsApiError.message : String(marketsApiError);
      return err(`markets API unreachable: ${message}`);
    }
    const parsedMarkets: GatewayMarket[] = [];
    for (const rawMarket of rawMarkets) {
      const parsed = parseMarketRecord(rawMarket);
      if (parsed.ok) {
        parsedMarkets.push(parsed.value);
      } else {
        console.warn(`[listMarkets] skipping malformed market: ${parsed.reason}`);
      }
    }
    if (parsedMarkets.length === 0) {
      return err("markets API returned no parseable markets");
    }
    marketsCache = { fetchedAtMs: nowMs, markets: parsedMarkets };
    return ok(parsedMarkets);
  };

  const resolveMarket = async (slugOrAddress: string): Promise<Result<GatewayMarket>> => {
    const marketsResult = await listMarkets();
    if (!marketsResult.ok) {
      return marketsResult;
    }
    const foundMarket = marketsResult.value.find(
      (market) => market.slug === slugOrAddress || market.address === slugOrAddress,
    );
    if (!foundMarket) {
      return err(`unknown market "${slugOrAddress}": list valid slugs via GET /markets`);
    }
    return ok(foundMarket);
  };

  return { listMarkets, resolveMarket };
};
