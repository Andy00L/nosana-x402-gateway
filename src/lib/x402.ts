import { X402PaymentHandler } from "x402-solana/server";
import type {
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "x402-solana/server";
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

// x402-solana's client (createPaymentFetch) upgrades to the v2 protocol, and so
// sends its payment in the PAYMENT-SIGNATURE header the v2 server reads, ONLY
// when the 402 response carries a PAYMENT-REQUIRED header. Without that header
// the client silently downgrades to v1 and sends X-PAYMENT, which
// X402PaymentHandler.extractPayment never reads (it reads PAYMENT-SIGNATURE
// only), so the payment is dropped and the 402 repeats. Set this on every 402.
//   sourceRef: x402-solana dist/client/index.js createPaymentFetch (branches on
//   response.headers PAYMENT-REQUIRED); dist/server/index.js extractPayment.
export const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";

// Encode the payment-required body the same way @payai/x402 safeBase64Encode
// does (standard base64 of the UTF-8 JSON) so the client's safeBase64Decode
// (atob) round-trips it. sourceRef: @payai/x402 dist/.../utils safeBase64Encode.
export const encodePaymentRequiredHeader = (paymentRequiredBody: unknown): string =>
  Buffer.from(JSON.stringify(paymentRequiredBody), "utf8").toString("base64");

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

// The subset of the x402 handler the payment gauntlet needs. Narrowing to this
// lets the gauntlet be unit-tested with a stub, and the real handler satisfies
// it structurally.
export type PaymentFacilitatorClient = Pick<
  X402PaymentHandler,
  "verifyPayment" | "settlePayment"
>;

// verify and settle also reach the facilitator over the network and throw on
// transport failure; wrapped for the same errors-as-values reason as above.
// A thrown transport error is distinct from a rejected payment: the first is
// our 502, the second is the agent's 402.
export const verifyPaymentSafely = async (
  x402Handler: PaymentFacilitatorClient,
  paymentHeader: string,
  requirements: PaymentRequirements,
): Promise<Result<VerifyResponse>> => {
  try {
    return ok(await x402Handler.verifyPayment(paymentHeader, requirements));
  } catch (verifyTransportError) {
    const message =
      verifyTransportError instanceof Error
        ? verifyTransportError.message
        : String(verifyTransportError);
    return err(`facilitator unreachable during payment verification: ${message}`);
  }
};

export const settlePaymentSafely = async (
  x402Handler: PaymentFacilitatorClient,
  paymentHeader: string,
  requirements: PaymentRequirements,
): Promise<Result<SettleResponse>> => {
  try {
    return ok(await x402Handler.settlePayment(paymentHeader, requirements));
  } catch (settleTransportError) {
    const message =
      settleTransportError instanceof Error
        ? settleTransportError.message
        : String(settleTransportError);
    return err(`facilitator unreachable during payment settlement: ${message}`);
  }
};
