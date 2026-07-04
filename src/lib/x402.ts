import { X402PaymentHandler } from "x402-solana/server";
import type { PaymentRequirements } from "x402-solana/server";
import { getDefaultTokenAsset } from "x402-solana/utils";
import { type Result, ok, err } from "./result.js";
import { QUOTE_TIMEOUT_SECONDS, type GatewayConfig } from "../config.js";
import type { RentQuote } from "./pricing.js";

export const buildX402Handler = (config: GatewayConfig): X402PaymentHandler =>
  new X402PaymentHandler({
    network: config.x402Network,
    treasuryAddress: config.treasuryAddress,
    facilitatorUrl: config.facilitatorUrl,
    defaultTimeoutSeconds: QUOTE_TIMEOUT_SECONDS,
  });

// createPaymentRequirements calls the facilitator (getFeePayer) over the
// network and throws on failure; wrap it so callers branch on a Result
// instead of catching (errors as values, SKILL_GENERAL.md section 5).
export const buildPaymentRequirementsSafely = async (
  x402Handler: X402PaymentHandler,
  config: GatewayConfig,
  quote: RentQuote,
  resourceUrl: string,
): Promise<Result<PaymentRequirements>> => {
  try {
    const requirements = await x402Handler.createPaymentRequirements(
      {
        amount: quote.amountAtomic,
        asset: getDefaultTokenAsset(config.x402Network),
        description: `Nosana GPU rental: ${quote.market.name} for ${quote.durationMinutes} minutes`,
        mimeType: "application/json",
        maxTimeoutSeconds: QUOTE_TIMEOUT_SECONDS,
      },
      resourceUrl,
    );
    return ok(requirements);
  } catch (facilitatorError) {
    const message =
      facilitatorError instanceof Error ? facilitatorError.message : String(facilitatorError);
    return err(`facilitator unreachable while building payment requirements: ${message}`);
  }
};
