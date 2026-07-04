import { Hono } from "hono";
import { respondWithJsonError } from "../lib/httpError.js";
import type { MarketsService } from "../lib/markets.js";

// Discovery endpoint: GPU tiers with their live USD rate, so an agent can pick
// a market slug without knowing Solana addresses.
export const createMarketsRouter = (marketsService: MarketsService): Hono => {
  const marketsRouter = new Hono();

  marketsRouter.get("/", async (context) => {
    const marketsResult = await marketsService.listMarkets();
    if (!marketsResult.ok) {
      return respondWithJsonError(context, 502, marketsResult.reason);
    }
    const marketList = marketsResult.value.map((market) => ({
      slug: market.slug,
      name: market.name,
      address: market.address,
      usd_per_hour: market.usdRewardPerHour,
      type: market.type,
    }));
    return context.json({ markets: marketList });
  });

  return marketsRouter;
};
