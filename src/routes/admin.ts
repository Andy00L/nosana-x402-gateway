import { Hono } from "hono";
import type { Context } from "hono";
import { timingSafeEqual } from "node:crypto";
import { fromAtomicUnits, getDefaultTokenAsset } from "x402-solana/utils";
import { USDC_DECIMALS } from "../lib/pricing.js";
import { respondWithJsonError } from "../lib/httpError.js";
import { isPlausibleSignature } from "../lib/paymentFlow.js";
import type {
  LedgerSummary,
  SettlementRecord,
  SettlementStore,
} from "../lib/settlementStore.js";
import type { ProvisioningService } from "../lib/provisioning.js";
import type { GatewayConfig } from "../config.js";

// Constant-time token check so a network attacker cannot recover the admin
// token byte by byte from response timing. The length pre-check leaks only the
// token length, which is not sensitive.
const isAdminTokenValid = (provided: string | undefined, expected: string): boolean => {
  if (!provided) {
    return false;
  }
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length) {
    return false;
  }
  return timingSafeEqual(providedBytes, expectedBytes);
};

// Sum atomic-unit strings in BigInt so reconciliation never loses precision.
const sumAtomic = (...atomicStrings: string[]): bigint =>
  atomicStrings.reduce((runningTotal, value) => runningTotal + BigInt(value), 0n);

// Reconciliation view derived from the ledger. The core identity, exact to the
// unit: usdcIn = creditsSpent + custodialFloat + refunded. usdcIn is every
// payment that settled on chain (or may have, settle_unknown); creditsSpent is
// what turned into a running deployment; custodialFloat is money received but
// not yet delivered as compute (refunds owed, in-flight settle, and unresolved
// settles); refunded is money already sent back to its payer.
// settle_rejected moved no money and is excluded from all four.
const buildReconciliation = (summary: LedgerSummary) => {
  const usdcInAtomic = sumAtomic(
    summary.settledAtomicTotal,
    summary.provisionedAtomicTotal,
    summary.provisionFailedAtomicTotal,
    summary.settleUnknownAtomicTotal,
    summary.refundedAtomicTotal,
  );
  const creditsSpentAtomic = BigInt(summary.provisionedAtomicTotal);
  const custodialFloatAtomic = sumAtomic(
    summary.settledAtomicTotal,
    summary.provisionFailedAtomicTotal,
    summary.settleUnknownAtomicTotal,
  );
  const refundedAtomic = BigInt(summary.refundedAtomicTotal);
  return {
    usdc_in_atomic: usdcInAtomic.toString(),
    usdc_in_usd: fromAtomicUnits(usdcInAtomic.toString(), USDC_DECIMALS),
    credits_spent_atomic: creditsSpentAtomic.toString(),
    custodial_float_atomic: custodialFloatAtomic.toString(),
    custodial_float_usd: fromAtomicUnits(custodialFloatAtomic.toString(), USDC_DECIMALS),
    refunded_atomic: refundedAtomic.toString(),
    refunded_usd: fromAtomicUnits(refundedAtomic.toString(), USDC_DECIMALS),
    refund_owed_count:
      summary.settledCount + summary.provisionFailedCount + summary.settleUnknownCount,
  };
};

// Exact USDC amount for the spl-token CLI, formatted from the atomic string
// with pure string math: no float ever touches a refund amount
// (REFERENCE_SECURITY_AUDIT.md 3.1). 10000 atomic (6 decimals) -> "0.01".
const formatAtomicUsdcAmount = (amountAtomic: string): string => {
  const padded = amountAtomic.padStart(USDC_DECIMALS + 1, "0");
  const wholePart = padded.slice(0, -USDC_DECIMALS);
  const fractionPart = padded.slice(-USDC_DECIMALS).replace(/0+$/, "");
  return fractionPart ? `${wholePart}.${fractionPart}` : wholePart;
};

// The ready-to-run refund transfer for one owed payment. A prebuilt unsigned
// transaction was rejected on purpose: its blockhash expires in about two
// minutes, long before an operator signs by hand. The spl-token command is
// signed and sent in one step with the treasury keypair. --fund-recipient
// covers a payer whose USDC token account was closed after paying.
const buildRefundCommand = (
  usdcMintAddress: string,
  record: SettlementRecord,
): string | null => {
  if (!record.payer) {
    return null;
  }
  const uiAmount = formatAtomicUsdcAmount(record.amountAtomic);
  return `spl-token transfer ${usdcMintAddress} ${uiAmount} ${record.payer} --fund-recipient`;
};

const REFUNDS_HOW_TO =
  "Run each refund_command with the treasury keypair as the signer. When a command is null the payer is unknown: find the sender of tx_signature on-chain first. After a transfer lands, record it with POST /admin/refunds/:payment_key/mark-refunded {\"refund_tx_signature\": \"...\"} to close the row.";

interface AdminRouterDependencies {
  readonly config: Pick<GatewayConfig, "adminToken" | "x402Network">;
  readonly settlementStore: Pick<
    SettlementStore,
    "summarizeLedger" | "listPaidWithoutDeployment" | "markRefunded"
  >;
  readonly creditsSource: Pick<ProvisioningService, "getCreditsBalance">;
}

// Operator-only reconciliation and refund tooling. Off by default: with no
// ADMIN_TOKEN set every admin route returns 404 and exposes nothing.
export const createAdminRouter = (dependencies: AdminRouterDependencies): Hono => {
  const { config, settlementStore, creditsSource } = dependencies;
  const adminRouter = new Hono();

  // Shared gate for every admin route: 404 when the surface is disabled, 401
  // on a bad token, null when the request may proceed.
  const findAdminAuthFailure = (context: Context): Response | null => {
    if (!config.adminToken) {
      return respondWithJsonError(context, 404, "not found");
    }
    if (!isAdminTokenValid(context.req.header("x-admin-token"), config.adminToken)) {
      return respondWithJsonError(context, 401, "admin token missing or invalid");
    }
    return null;
  };

  adminRouter.get("/ledger", async (context) => {
    const authFailure = findAdminAuthFailure(context);
    if (authFailure) {
      return authFailure;
    }

    const summary = settlementStore.summarizeLedger();
    const balanceResult = await creditsSource.getCreditsBalance();

    return context.json({
      ledger: {
        reserved_count: summary.reservedCount,
        settled_count: summary.settledCount,
        provisioned_count: summary.provisionedCount,
        provision_failed_count: summary.provisionFailedCount,
        settle_unknown_count: summary.settleUnknownCount,
        settle_rejected_count: summary.settleRejectedCount,
        refunded_count: summary.refundedCount,
      },
      reconciliation: buildReconciliation(summary),
      nosana_credits: balanceResult.ok
        ? {
            assigned_usd: balanceResult.value.assignedUsd,
            reserved_usd: balanceResult.value.reservedUsd,
            settled_usd: balanceResult.value.settledUsd,
            available_usd: balanceResult.value.availableUsd,
          }
        : { error: balanceResult.reason },
    });
  });

  // Every refund owed, each with a ready-to-run spl-token transfer command.
  adminRouter.get("/refunds", (context) => {
    const authFailure = findAdminAuthFailure(context);
    if (authFailure) {
      return authFailure;
    }
    // USDC mint for the active network, from the same source the payment path
    // uses (sourceRef: x402-solana getDefaultTokenAsset), never hardcoded.
    const usdcMintAddress = getDefaultTokenAsset(config.x402Network).address;
    const refunds = settlementStore.listPaidWithoutDeployment().map((record) => ({
      payment_key: record.paymentKey,
      status: record.status,
      tx_signature: record.txSignature,
      payer: record.payer,
      market_slug: record.marketSlug,
      amount_atomic: record.amountAtomic,
      amount_usd: fromAtomicUnits(record.amountAtomic, USDC_DECIMALS),
      deployment_id: record.deploymentId,
      refund_command: buildRefundCommand(usdcMintAddress, record),
    }));
    return context.json({ refunds, how_to: REFUNDS_HOW_TO });
  });

  // Close a refund row after the operator's transfer landed on chain.
  adminRouter.post("/refunds/:paymentKey/mark-refunded", async (context) => {
    const authFailure = findAdminAuthFailure(context);
    if (authFailure) {
      return authFailure;
    }
    let rawBody: unknown;
    try {
      rawBody = await context.req.json();
    } catch {
      return respondWithJsonError(context, 400, "request body is not valid JSON");
    }
    const refundTxSignature =
      typeof rawBody === "object" && rawBody !== null
        ? (rawBody as Record<string, unknown>).refund_tx_signature
        : undefined;
    if (typeof refundTxSignature !== "string" || !isPlausibleSignature(refundTxSignature)) {
      return respondWithJsonError(
        context,
        400,
        '"refund_tx_signature" is required: the base58 signature of the refund transfer',
      );
    }
    const paymentKey = context.req.param("paymentKey");
    const marked = settlementStore.markRefunded(paymentKey, refundTxSignature);
    if (!marked.ok) {
      return respondWithJsonError(
        context,
        marked.reason.code === "not_found" ? 404 : 409,
        marked.reason.message,
      );
    }
    console.log(
      `[createAdminRouter] refund recorded: payment=${paymentKey} refundTx=${refundTxSignature}`,
    );
    return context.json({
      payment_key: paymentKey,
      status: "refunded",
      refund_tx_signature: refundTxSignature,
    });
  });

  return adminRouter;
};
