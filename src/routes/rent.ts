import { Hono } from "hono";
import { validateJobDefinition } from "@nosana/kit";
import type { X402PaymentHandler } from "x402-solana/server";
import { type Result, ok, err } from "../lib/result.js";
import { respondWithJsonError } from "../lib/httpError.js";
import type { MarketsService } from "../lib/markets.js";
import { computeRentQuote } from "../lib/pricing.js";
import {
  buildPaymentRequirementsSafely,
  verifyPaymentSafely,
  settlePaymentSafely,
} from "../lib/x402.js";
import { hashPaymentHeader, type SettlementStore } from "../lib/settlementStore.js";
import type { ProvisioningService } from "../lib/provisioning.js";
import { createRentSession } from "../lib/session.js";
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
  readonly settlementStore: SettlementStore;
  readonly provisioningService: ProvisioningService;
}

export const createRentRouter = (dependencies: RentRouterDependencies): Hono => {
  const { config, marketsService, x402Handler, settlementStore, provisioningService } =
    dependencies;
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
      // When fulfillment is configured, refuse a quote the credits balance
      // cannot cover, so no agent is ever invited to pay for capacity that is
      // not there (docs/x402-execution-plan.md step A.3). An unconfigured
      // gateway still quotes for local development; its payment path refuses
      // before any money moves.
      if (provisioningService.isConfigured) {
        const capacityCheck = await provisioningService.checkCreditsCoverQuote(
          quoteResult.value,
        );
        if (!capacityCheck.ok) {
          return respondWithJsonError(context, 503, capacityCheck.reason);
        }
      }
      const paymentRequiredResponse = x402Handler.create402Response(
        requirementsResult.value,
        context.req.url,
      );
      console.log(
        `[createRentRouter] 402 quote: market=${quoteResult.value.market.slug} minutes=${quoteResult.value.durationMinutes} amountAtomic=${quoteResult.value.amountAtomic}`,
      );
      return context.json(paymentRequiredResponse.body, 402);
    }

    // Payment path. Order is deliberate: refuse-if-unfulfillable, verify,
    // reserve (anti-replay), capacity, settle, record, provision, session.
    // Settle happens BEFORE provision: verify checks validity, not on-chain
    // finality, and a GPU is an irreversible handout
    // (docs/x402-execution-plan.md section 4 step B).
    if (!provisioningService.isConfigured) {
      return respondWithJsonError(
        context,
        503,
        "gateway is not configured for fulfillment (no Nosana API key): payment refused before any money moved",
      );
    }

    const verifyResult = await verifyPaymentSafely(
      x402Handler,
      paymentHeader,
      requirementsResult.value,
    );
    if (!verifyResult.ok) {
      return respondWithJsonError(context, 502, verifyResult.reason);
    }
    if (!verifyResult.value.isValid) {
      return respondWithJsonError(
        context,
        402,
        `payment verification failed: ${verifyResult.value.invalidReason ?? "invalid payment"}`,
      );
    }

    const paymentKey = hashPaymentHeader(paymentHeader);
    const reservation = settlementStore.reservePayment(paymentKey, {
      marketSlug: quoteResult.value.market.slug,
      durationMinutes: quoteResult.value.durationMinutes,
      amountAtomic: quoteResult.value.amountAtomic,
    });
    if (!reservation.ok) {
      return respondWithJsonError(context, 409, reservation.reason);
    }

    const capacityCheck = await provisioningService.checkCreditsCoverQuote(quoteResult.value);
    if (!capacityCheck.ok) {
      settlementStore.releaseReservation(paymentKey);
      return respondWithJsonError(context, 503, capacityCheck.reason);
    }

    const settleResult = await settlePaymentSafely(
      x402Handler,
      paymentHeader,
      requirementsResult.value,
    );
    if (!settleResult.ok) {
      settlementStore.releaseReservation(paymentKey);
      return respondWithJsonError(context, 502, settleResult.reason);
    }
    if (!settleResult.value.success) {
      settlementStore.releaseReservation(paymentKey);
      return respondWithJsonError(
        context,
        402,
        `payment settlement failed: ${settleResult.value.errorReason ?? "settlement rejected"}`,
      );
    }

    const txSignature = settleResult.value.transaction;
    const payer = verifyResult.value.payer ?? settleResult.value.payer ?? null;
    const settledRecord = settlementStore.markSettled(paymentKey, txSignature, payer);
    if (!settledRecord.ok) {
      // Money settled but the transaction signature was already recorded under
      // another payment key: replay caught at the last gate, do not provision.
      console.error(`[createRentRouter] ${settledRecord.reason} tx=${txSignature}`);
      return respondWithJsonError(context, 409, settledRecord.reason);
    }

    const provisionResult = await provisioningService.provisionDeployment({
      marketAddress: quoteResult.value.market.address,
      marketSlug: quoteResult.value.market.slug,
      durationMinutes: quoteResult.value.durationMinutes,
      jobDefinition: jobValidation.data,
      paymentKey,
    });
    if (!provisionResult.ok) {
      // Paid but not provisioned: the exact case the refund path exists for.
      // Recorded in the store; the startup recovery scan lists these loudly.
      settlementStore.markProvisionFailed(paymentKey, null);
      console.error(
        `[createRentRouter] PAID BUT PROVISION FAILED tx=${txSignature} reason=${provisionResult.reason}`,
      );
      return respondWithJsonError(
        context,
        502,
        `payment settled but provisioning failed: the payment is recorded for refund, keep transaction signature ${txSignature}`,
      );
    }
    settlementStore.markProvisioned(paymentKey, provisionResult.value.deploymentId);

    const session = await createRentSession({
      deploymentId: provisionResult.value.deploymentId,
      payer,
      txSignature,
      durationMinutes: quoteResult.value.durationMinutes,
      jwtSecret: config.jwtSecret,
    });

    console.log(
      `[createRentRouter] rented: deployment=${provisionResult.value.deploymentId} market=${quoteResult.value.market.slug} minutes=${quoteResult.value.durationMinutes} tx=${txSignature}`,
    );
    return context.json({
      deployment_id: provisionResult.value.deploymentId,
      status: provisionResult.value.status,
      endpoints: provisionResult.value.endpoints,
      session,
      payment: {
        tx_signature: txSignature,
        amount_atomic: quoteResult.value.amountAtomic,
        amount_usd: quoteResult.value.amountUsd,
      },
    });
  });

  return rentRouter;
};
