import { Hono } from "hono";
import type { Context } from "hono";
import { validateJobDefinition } from "@nosana/kit";
import type { PaymentRequirements, X402PaymentHandler } from "x402-solana/server";
import { type Result, ok, err } from "../lib/result.js";
import { respondWithJsonError } from "../lib/httpError.js";
import type { MarketsService } from "../lib/markets.js";
import { computeRentQuote, type RentQuote } from "../lib/pricing.js";
import {
  buildPaymentRequirementsSafely,
  PAYMENT_REQUIRED_HEADER,
  encodePaymentRequiredHeader,
} from "../lib/x402.js";
import { collectPayment } from "../lib/paymentFlow.js";
import { buildPaymentChallengeHint, buildRentNextSteps } from "../lib/agentGuide.js";
import type { SettlementStore } from "../lib/settlementStore.js";
import type { ProvisioningService } from "../lib/provisioning.js";
import { createRentSession, verifyRentSession } from "../lib/session.js";
import {
  type AvailabilityService,
  type MarketAvailability,
  formatAvailability,
  shouldRefuseUnavailable,
} from "../lib/availability.js";
import {
  MIN_RENT_DURATION_MINUTES,
  MAX_RENT_DURATION_MINUTES,
  type GatewayConfig,
} from "../config.js";

const validateDurationMinutes = (value: unknown): Result<number> => {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return err('"duration_minutes" is required and must be an integer');
  }
  if (value < MIN_RENT_DURATION_MINUTES || value > MAX_RENT_DURATION_MINUTES) {
    return err(
      `"duration_minutes" must be between ${MIN_RENT_DURATION_MINUTES} and ${MAX_RENT_DURATION_MINUTES}`,
    );
  }
  return ok(value);
};

const parseJsonObjectBody = (body: unknown): Result<Record<string, unknown>> => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return err("request body must be a JSON object");
  }
  return ok(body as Record<string, unknown>);
};

interface RentRequest {
  readonly market: string;
  readonly durationMinutes: number;
  readonly jobDefinition: unknown;
  // Opt-in safety valve: when true, the gateway refuses to charge unless a GPU
  // host is idle in this market right now, instead of taking payment and sitting
  // in the market queue. Defaults to false (pay and wait for a host).
  readonly requireAvailable: boolean;
}

const parseRentRequest = (body: unknown): Result<RentRequest> => {
  const objectBody = parseJsonObjectBody(body);
  if (!objectBody.ok) {
    return objectBody;
  }
  const { market, duration_minutes, job_definition, require_available } = objectBody.value;
  if (typeof market !== "string" || market.length === 0) {
    return err('"market" is required: a market slug (see GET /markets) or address');
  }
  const durationCheck = validateDurationMinutes(duration_minutes);
  if (!durationCheck.ok) {
    return durationCheck;
  }
  if (job_definition === undefined || job_definition === null) {
    return err('"job_definition" is required: a Nosana job definition object');
  }
  if (require_available !== undefined && typeof require_available !== "boolean") {
    return err('"require_available" must be a boolean when provided');
  }
  return ok({
    market,
    durationMinutes: durationCheck.value,
    jobDefinition: job_definition,
    requireAvailable: require_available === true,
  });
};

const parseExtendRequest = (body: unknown): Result<number> => {
  const objectBody = parseJsonObjectBody(body);
  if (!objectBody.ok) {
    return objectBody;
  }
  return validateDurationMinutes(objectBody.value.duration_minutes);
};

interface RentRouterDependencies {
  readonly config: GatewayConfig;
  readonly marketsService: MarketsService;
  readonly availabilityService: AvailabilityService;
  readonly x402Handler: X402PaymentHandler;
  readonly settlementStore: SettlementStore;
  readonly provisioningService: ProvisioningService;
}

export const createRentRouter = (dependencies: RentRouterDependencies): Hono => {
  const {
    config,
    marketsService,
    availabilityService,
    x402Handler,
    settlementStore,
    provisioningService,
  } = dependencies;
  const rentRouter = new Hono();

  // Quote branch shared by /rent and /rent/:id/extend. When fulfillment is
  // configured, refuse a quote the credits balance cannot cover, so no agent
  // is ever invited to pay for capacity that is not there
  // (docs/x402-execution-plan.md step A.3). An unconfigured gateway still
  // quotes for local development; its payment path refuses before money moves.
  const respondWithPaymentRequired = async (
    context: Context,
    quote: RentQuote,
    requirements: PaymentRequirements,
    availability?: Result<MarketAvailability>,
  ) => {
    if (provisioningService.isConfigured) {
      const capacityCheck = await provisioningService.checkCreditsCoverQuote(quote);
      if (!capacityCheck.ok) {
        return respondWithJsonError(context, 503, capacityCheck.reason);
      }
    }
    const paymentRequiredResponse = x402Handler.create402Response(requirements, context.req.url);
    console.log(
      `[respondWithPaymentRequired] 402 quote: market=${quote.market.slug} minutes=${quote.durationMinutes} amountAtomic=${quote.amountAtomic}`,
    );
    // Advertise x402 v2 so the client pays with the PAYMENT-SIGNATURE header the
    // handler reads, instead of silently downgrading to v1/X-PAYMENT and having
    // the payment dropped (see encodePaymentRequiredHeader).
    context.header(
      PAYMENT_REQUIRED_HEADER,
      encodePaymentRequiredHeader(paymentRequiredResponse.body),
    );
    // x402 v2 body is { x402Version, error, accepts } (sourceRef: x402-solana
    // create402Response). The sibling `hint` and `availability` blocks are
    // non-breaking: the x402 client parses `accepts` and strips unknown keys, so
    // only an agent reading the raw JSON sees them. `hint` makes the challenge
    // self-describing on every 402; `availability` rides only the rent quote,
    // since extend's host is already assigned to the running deployment.
    const responseBody = {
      ...paymentRequiredResponse.body,
      hint: buildPaymentChallengeHint(),
      ...(availability ? { availability: formatAvailability(availability) } : {}),
    };
    return context.json(responseBody, 402);
  };

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
      return respondWithJsonError(context, isUpstreamFailure ? 502 : 404, marketResult.reason);
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

    // Read GPU availability once (best-effort, cached) and reuse it for the
    // opt-in require_available gate and the 402 disclosure below, so an agent
    // learns before paying whether a host is idle now or it will wait in the
    // market queue. Checked before building payment requirements so a
    // require_available refusal costs no facilitator round-trip.
    const availability = await availabilityService.getMarketAvailability(
      quoteResult.value.market.address,
    );
    if (shouldRefuseUnavailable(rentRequest.value.requireAvailable, availability)) {
      return respondWithJsonError(
        context,
        409,
        "require_available was set but no GPU host is idle in this market right now: retry later, or omit require_available to pay and wait in the queue",
      );
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
      return respondWithPaymentRequired(
        context,
        quoteResult.value,
        requirementsResult.value,
        availability,
      );
    }

    const payment = await collectPayment(
      { x402Handler, settlementStore, provisioningService },
      paymentHeader,
      requirementsResult.value,
      quoteResult.value,
    );
    if (!payment.ok) {
      return respondWithJsonError(context, payment.reason.status, payment.reason.message);
    }

    const provisionResult = await provisioningService.provisionDeployment({
      marketAddress: quoteResult.value.market.address,
      marketSlug: quoteResult.value.market.slug,
      durationMinutes: quoteResult.value.durationMinutes,
      jobDefinition: jobValidation.data,
      paymentKey: payment.value.paymentKey,
    });
    if (!provisionResult.ok) {
      // Paid but not provisioned: the exact case the refund path exists for.
      // Record the created deployment id when there is one (start failed after
      // create) so recovery can find and stop the orphan (audit H3).
      settlementStore.markProvisionFailed(
        payment.value.paymentKey,
        provisionResult.reason.deploymentId,
      );
      console.error(
        `[createRentRouter] PAID BUT PROVISION FAILED tx=${payment.value.txSignature} deployment=${provisionResult.reason.deploymentId} reason=${provisionResult.reason.message}`,
      );
      return respondWithJsonError(
        context,
        502,
        `payment settled but provisioning failed: the payment is recorded for refund, keep transaction signature ${payment.value.txSignature}`,
      );
    }
    settlementStore.markProvisioned(payment.value.paymentKey, provisionResult.value.deploymentId);

    const session = await createRentSession({
      deploymentId: provisionResult.value.deploymentId,
      payer: payment.value.payer,
      txSignature: payment.value.txSignature,
      durationMinutes: quoteResult.value.durationMinutes,
      jwtSecret: config.jwtSecret,
    });

    console.log(
      `[createRentRouter] rented: deployment=${provisionResult.value.deploymentId} market=${quoteResult.value.market.slug} minutes=${quoteResult.value.durationMinutes} tx=${payment.value.txSignature}`,
    );
    return context.json({
      deployment_id: provisionResult.value.deploymentId,
      status: provisionResult.value.status,
      endpoints: provisionResult.value.endpoints,
      session,
      payment: {
        tx_signature: payment.value.txSignature,
        amount_atomic: quoteResult.value.amountAtomic,
        amount_usd: quoteResult.value.amountUsd,
      },
      // Tell the agent how to drive the rental it just paid for (poll, extend,
      // stop) and where results come from on the credits rail.
      next: buildRentNextSteps(provisionResult.value.deploymentId),
    });
  });

  rentRouter.get("/:id", async (context) => {
    const deploymentId = context.req.param("id");
    const session = await verifyRentSession({
      authorizationHeader: context.req.header("authorization"),
      expectedDeploymentId: deploymentId,
      jwtSecret: config.jwtSecret,
    });
    if (!session.ok) {
      return respondWithJsonError(context, 401, session.reason);
    }
    const snapshot = await provisioningService.getDeployment(deploymentId);
    if (!snapshot.ok) {
      return respondWithJsonError(context, 502, snapshot.reason);
    }
    return context.json({
      deployment_id: snapshot.value.deploymentId,
      status: snapshot.value.status,
      endpoints: snapshot.value.endpoints,
      timeout_minutes: snapshot.value.timeoutMinutes,
    });
  });

  rentRouter.post("/:id/extend", async (context) => {
    const deploymentId = context.req.param("id");
    const session = await verifyRentSession({
      authorizationHeader: context.req.header("authorization"),
      expectedDeploymentId: deploymentId,
      jwtSecret: config.jwtSecret,
    });
    if (!session.ok) {
      return respondWithJsonError(context, 401, session.reason);
    }

    let rawBody: unknown;
    try {
      rawBody = await context.req.json();
    } catch {
      return respondWithJsonError(context, 400, "request body is not valid JSON");
    }
    const extendMinutes = parseExtendRequest(rawBody);
    if (!extendMinutes.ok) {
      return respondWithJsonError(context, 400, extendMinutes.reason);
    }

    const snapshot = await provisioningService.getDeployment(deploymentId);
    if (!snapshot.ok) {
      return respondWithJsonError(context, 502, snapshot.reason);
    }

    // The extension is priced from the deployment's own market, at the live
    // rate, server-side, exactly like the original rental.
    const marketResult = await marketsService.resolveMarket(snapshot.value.marketAddress);
    if (!marketResult.ok) {
      const isUpstreamFailure = marketResult.reason.startsWith("markets API");
      return respondWithJsonError(context, isUpstreamFailure ? 502 : 404, marketResult.reason);
    }
    const quoteResult = computeRentQuote(marketResult.value, extendMinutes.value);
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
      return respondWithPaymentRequired(context, quoteResult.value, requirementsResult.value);
    }

    const payment = await collectPayment(
      { x402Handler, settlementStore, provisioningService },
      paymentHeader,
      requirementsResult.value,
      quoteResult.value,
    );
    if (!payment.ok) {
      return respondWithJsonError(context, payment.reason.status, payment.reason.message);
    }

    const extendResult = await provisioningService.extendDeployment(
      deploymentId,
      extendMinutes.value,
    );
    if (!extendResult.ok) {
      settlementStore.markProvisionFailed(payment.value.paymentKey, deploymentId);
      console.error(
        `[createRentRouter] PAID BUT EXTEND FAILED tx=${payment.value.txSignature} reason=${extendResult.reason}`,
      );
      return respondWithJsonError(
        context,
        502,
        `payment settled but the extension failed: the payment is recorded for refund, keep transaction signature ${payment.value.txSignature}`,
      );
    }
    settlementStore.markProvisioned(payment.value.paymentKey, deploymentId);

    // Refresh the session so it outlives the extended rental. The expiry is
    // sized from the deployment's new TOTAL timeout but anchored to the original
    // session start (its iat), not now, so cumulative extends do not inflate the
    // session far past the real compute window (audit M3).
    const refreshedSession = await createRentSession({
      deploymentId,
      payer: payment.value.payer,
      txSignature: payment.value.txSignature,
      durationMinutes: extendResult.value.timeoutMinutes,
      jwtSecret: config.jwtSecret,
      startedAtSeconds: session.value.iat,
    });

    console.log(
      `[createRentRouter] extended: deployment=${deploymentId} addedMinutes=${extendMinutes.value} newTimeout=${extendResult.value.timeoutMinutes} tx=${payment.value.txSignature}`,
    );
    return context.json({
      deployment_id: deploymentId,
      status: extendResult.value.status,
      timeout_minutes: extendResult.value.timeoutMinutes,
      session: refreshedSession,
      payment: {
        tx_signature: payment.value.txSignature,
        amount_atomic: quoteResult.value.amountAtomic,
        amount_usd: quoteResult.value.amountUsd,
      },
    });
  });

  rentRouter.post("/:id/stop", async (context) => {
    const deploymentId = context.req.param("id");
    const session = await verifyRentSession({
      authorizationHeader: context.req.header("authorization"),
      expectedDeploymentId: deploymentId,
      jwtSecret: config.jwtSecret,
    });
    if (!session.ok) {
      return respondWithJsonError(context, 401, session.reason);
    }
    const stopResult = await provisioningService.stopDeployment(deploymentId);
    if (!stopResult.ok) {
      return respondWithJsonError(context, 502, stopResult.reason);
    }
    // Refund of unused minutes is Phase 4 work (docs/x402-execution-plan.md):
    // it requires the treasury hot wallet and is gated behind the security
    // audit. On devnet the stop is recorded; no refund is issued yet.
    console.log(`[createRentRouter] stopped: deployment=${deploymentId}`);
    return context.json({
      deployment_id: deploymentId,
      status: stopResult.value.status,
    });
  });

  return rentRouter;
};
