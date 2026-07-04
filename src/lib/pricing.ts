import { fromAtomicUnits } from "x402-solana/utils";
import { type Result, ok, err } from "./result.js";
import type { GatewayMarket } from "./markets.js";

// USDC has 6 decimals, so 1 micro-USD equals 1 USDC atomic unit and the
// Credits par mapping stays 1:1 (sourceRef: x402-solana getDefaultTokenAsset).
export const USDC_DECIMALS = 6;
const MICRO_USD_PER_USD = 1_000_000;
const MINUTES_PER_HOUR = 60n;

export interface RentQuote {
  // Price in USDC atomic units, the exact `amount` for PaymentRequirements.
  readonly amountAtomic: string;
  // Human-readable USD amount, display only, never used for settlement math.
  readonly amountUsd: number;
  readonly market: GatewayMarket;
  readonly durationMinutes: number;
}

// Server-side pricing only: the amount is derived from the market's live rate,
// never from client input (docs/x402-execution-plan.md section 7).
// The API serves usd_reward_per_hour as a JSON float, so one rounding step to
// integer micro-USD is unavoidable; every step after that is integer math
// (floating point for settlement money is a bug, REFERENCE_SECURITY_AUDIT.md 3.1).
// OPEN QUESTION recorded in the plan: whether network_fee_percentage is added
// on top for the renter. v1 charges the base rate until the team answers;
// resolve before Phase 1 sign-off or reconciliation drifts.
export const computeRentQuote = (
  market: GatewayMarket,
  durationMinutes: number,
): Result<RentQuote> => {
  const microUsdPerHour = BigInt(Math.round(market.usdRewardPerHour * MICRO_USD_PER_USD));
  if (microUsdPerHour <= 0n) {
    return err(`market "${market.slug}" has a non-positive hourly price`);
  }
  // Ceiling division so a rounding step never undercharges below the market rate.
  const amountAtomic =
    (microUsdPerHour * BigInt(durationMinutes) + MINUTES_PER_HOUR - 1n) / MINUTES_PER_HOUR;
  return ok({
    amountAtomic: amountAtomic.toString(),
    amountUsd: fromAtomicUnits(amountAtomic.toString(), USDC_DECIMALS),
    market,
    durationMinutes,
  });
};
