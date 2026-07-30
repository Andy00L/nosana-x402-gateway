import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { respondWithJsonError } from "../lib/httpError.js";
import type { MarketsService } from "../lib/markets.js";
import {
  type AvailabilityService,
  formatAvailability,
  selectAvailability,
} from "../lib/availability.js";

// Discovery endpoint: GPU tiers with their live USD rate and current queue
// availability, so an agent can pick a market slug (without knowing Solana
// addresses) AND see, before paying, which markets have an idle host now versus
// which would queue. Availability is best-effort: if the on-chain queue read
// fails, markets still list with availability "unknown". The whole surface is
// unpaid and fans out to the markets API and the chain, so it sits behind the
// caller-supplied rate limit middleware (see src/lib/rateLimit.ts).
export const createMarketsRouter = (
  marketsService: MarketsService,
  availabilityService: AvailabilityService,
  unpaidRateLimit: MiddlewareHandler,
): Hono => {
  const marketsRouter = new Hono();
  marketsRouter.use("*", unpaidRateLimit);

  marketsRouter.get("/", async (context) => {
    const marketsResult = await marketsService.listMarkets();
    if (!marketsResult.ok) {
      return respondWithJsonError(context, 502, marketsResult.reason);
    }
    const availabilityResult = await availabilityService.listAvailability();
    const marketList = marketsResult.value.map((market) => ({
      slug: market.slug,
      name: market.name,
      address: market.address,
      usd_per_hour: market.usdRewardPerHour,
      type: market.type,
      availability: formatAvailability(selectAvailability(availabilityResult, market.address)),
    }));
    return context.json({ markets: marketList });
  });

  return marketsRouter;
};
