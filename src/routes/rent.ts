import { Hono } from "hono";
import { validateJobDefinition } from "@nosana/kit";
import type { X402PaymentHandler } from "x402-solana/server";
import { type Result, ok, err } from "../lib/result.js";
import { respondWithJsonError } from "../lib/httpError.js";
import type { MarketsService } from "../lib/markets.js";
import { computeRentQuote } from "../lib/pricing.js";
import { buildPaymentRequirementsSafely } from "../lib/x402.js";
import {
  MIN_RENT_DURATION_MINUTES,
  MAX_RENT_DURATION_MINUTES,
  type GatewayConfig,
} from "../config.js";

interface RentRequest {
  readonly market: string;
  readonly durationMinutes: number;
  readonly jobDefinition: unknown;
}

const parseRentRequest = (body: unknown): Result<RentRequest> => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return err("request body must be a JSON object");
  }
  const { market, duration_minutes, job_definition } = body as Record<string, unknown>;
  if (typeof market !== "string" || market.length === 0) {
    return err('"market" is required: a market slug (see GET /markets) or address');
  }
  if (typeof duration_minutes !== "number" || !Number.isInteger(duration_minutes)) {
    return err('"duration_minutes" is required and must be an integer');
  }
  if (
    duration_minutes < MIN_RENT_DURATION_MINUTES ||
    duration_minutes > MAX_RENT_DURATION_MINUTES
  ) {
    return err(
      `"duration_minutes" must be between ${MIN_RENT_DURATION_MINUTES} and ${MAX_RENT_DURATION_MINUTES}`,
    );
  }
  if (job_definition === undefined || job_definition === null) {
    return err('"job_definition" is required: a Nosana job definition object');
  }
  return ok({ market, durationMinutes: duration_minutes, jobDefinition: job_definition });
};

interface RentRouterDependencies {
  readonly config: GatewayConfig;
  readonly marketsService: MarketsService;
  readonly x402Handler: X402PaymentHandler;
}

export const createRentRouter = (dependencies: RentRouterDependencies): Hono => {
  const { config, marketsService, x402Handler } = dependencies;
  const rentRouter = new Hono();

  rentRouter.post("/", async (context) => {
    let rawBody: unknown;
    try {
      rawBody = await context.req.json();
    } catch {
      return respondWithJsonError(context, 400, "request body is not valid JSON");
    }

    const rentRequest = parseRentRequest(rawBody);
    if (!rentRequest.ok) {
      return respondWithJsonError(context, 400, rentRequest.reason);
    }

    const marketResult = await marketsService.resolveMarket(rentRequest.value.market);
    if (!marketResult.ok) {
      const isUpstreamFailure = marketResult.reason.startsWith("markets API");
      return respondWithJsonError(
        context,
        isUpstreamFailure ? 502 : 404,
        marketResult.reason,
      );
    }

    // Runtime-validate the job definition with the kit's own typia validator
    // so a malformed job fails here, not after money has moved.
    const jobValidation = validateJobDefinition(rentRequest.value.jobDefinition);
    if (!jobValidation.success) {
      const validationSummary = jobValidation.errors
        .slice(0, 5)
        .map((validationError) => `${validationError.path}: expected ${validationError.expected}`)
        .join("; ");
      return respondWithJsonError(context, 400, `invalid job_definition: ${validationSummary}`);
    }

    const quoteResult = computeRentQuote(marketResult.value, rentRequest.value.durationMinutes);
    if (!quoteResult.ok) {
      return respondWithJsonError(context, 500, quoteResult.reason);
    }

    const requirementsResult = await buildPaymentRequirementsSafely(
      x402Handler,
      config,
      quoteResult.value,
      context.req.url,
    );
    if (!requirementsResult.ok) {
      return respondWithJsonError(context, 502, requirementsResult.reason);
    }

    const paymentHeader = x402Handler.extractPayment(context.req.raw.headers);
    if (!paymentHeader) {
      // Quote path: no payment attached, answer 402 with the v2 requirements.
      const paymentRequiredResponse = x402Handler.create402Response(
        requirementsResult.value,
        context.req.url,
      );
      console.log(
        `[createRentRouter] 402 quote: market=${quoteResult.value.market.slug} minutes=${quoteResult.value.durationMinutes} amountAtomic=${quoteResult.value.amountAtomic}`,
      );
      return context.json(paymentRequiredResponse.body, 402);
    }

    // Payment path (verify, settle before provision, anti-replay, provision,
    // session) is Phase 1 step B and is not wired yet. Distinct status so
    // agents never mistake this for a payment failure.
    return respondWithJsonError(
      context,
      501,
      "payment settlement is not enabled on this gateway build yet: quoting works, paying lands in the next release",
    );
  });

  return rentRouter;
};
