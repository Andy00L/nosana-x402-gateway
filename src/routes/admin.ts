import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { fromAtomicUnits } from "x402-solana/utils";
import { USDC_DECIMALS } from "../lib/pricing.js";
import { respondWithJsonError } from "../lib/httpError.js";
import type { LedgerSummary, SettlementStore } from "../lib/settlementStore.js";
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
// unit: usdcIn = creditsSpent + custodialFloat. usdcIn is every payment that
// settled on chain (or may have, settle_unknown); creditsSpent is what turned
// into a running deployment; custodialFloat is money received but not yet
// delivered as compute (refunds owed, in-flight settle, and unresolved settles).
// settle_rejected moved no money and is excluded from all three.
const buildReconciliation = (summary: LedgerSummary) => {
  const usdcInAtomic = sumAtomic(
    summary.settledAtomicTotal,
    summary.provisionedAtomicTotal,
    summary.provisionFailedAtomicTotal,
    summary.settleUnknownAtomicTotal,
  );
  const creditsSpentAtomic = BigInt(summary.provisionedAtomicTotal);
  const custodialFloatAtomic = sumAtomic(
    summary.settledAtomicTotal,
    summary.provisionFailedAtomicTotal,
    summary.settleUnknownAtomicTotal,
  );
  return {
    usdc_in_atomic: usdcInAtomic.toString(),
    usdc_in_usd: fromAtomicUnits(usdcInAtomic.toString(), USDC_DECIMALS),
    credits_spent_atomic: creditsSpentAtomic.toString(),
    custodial_float_atomic: custodialFloatAtomic.toString(),
    custodial_float_usd: fromAtomicUnits(custodialFloatAtomic.toString(), USDC_DECIMALS),
    refund_owed_count:
      summary.settledCount + summary.provisionFailedCount + summary.settleUnknownCount,
  };
};

interface AdminRouterDependencies {
  readonly config: Pick<GatewayConfig, "adminToken">;
  readonly settlementStore: Pick<SettlementStore, "summarizeLedger">;
  readonly creditsSource: Pick<ProvisioningService, "getCreditsBalance">;
}

// Operator-only reconciliation. Off by default: with no ADMIN_TOKEN set the
// route returns 404 and exposes nothing.
export const createAdminRouter = (dependencies: AdminRouterDependencies): Hono => {
  const { config, settlementStore, creditsSource } = dependencies;
  const adminRouter = new Hono();

  adminRouter.get("/ledger", async (context) => {
    if (!config.adminToken) {
      return respondWithJsonError(context, 404, "not found");
    }
    if (!isAdminTokenValid(context.req.header("x-admin-token"), config.adminToken)) {
      return respondWithJsonError(context, 401, "admin token missing or invalid");
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

  return adminRouter;
};
