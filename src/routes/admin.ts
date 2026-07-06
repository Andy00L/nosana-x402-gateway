import { Hono } from "hono";
import { fromAtomicUnits } from "x402-solana/utils";
import { USDC_DECIMALS } from "../lib/pricing.js";
import { respondWithJsonError } from "../lib/httpError.js";
import type { LedgerSummary, SettlementStore } from "../lib/settlementStore.js";
import type { ProvisioningService } from "../lib/provisioning.js";
import type { GatewayConfig } from "../config.js";

// Sum atomic-unit strings in BigInt so reconciliation never loses precision.
const sumAtomic = (...atomicStrings: string[]): bigint =>
  atomicStrings.reduce((runningTotal, value) => runningTotal + BigInt(value), 0n);

// Reconciliation view derived from the ledger. The core identity, exact to the
// unit: usdcIn = creditsSpent + custodialFloat. usdcIn is every payment that
// settled on chain; creditsSpent is what turned into a running deployment;
// custodialFloat is money received but not yet delivered as compute (refunds
// owed plus any in-flight settle).
const buildReconciliation = (summary: LedgerSummary) => {
  const usdcInAtomic = sumAtomic(
    summary.settledAtomicTotal,
    summary.provisionedAtomicTotal,
    summary.provisionFailedAtomicTotal,
  );
  const creditsSpentAtomic = BigInt(summary.provisionedAtomicTotal);
  const custodialFloatAtomic = sumAtomic(
    summary.settledAtomicTotal,
    summary.provisionFailedAtomicTotal,
  );
  return {
    usdc_in_atomic: usdcInAtomic.toString(),
    usdc_in_usd: fromAtomicUnits(usdcInAtomic.toString(), USDC_DECIMALS),
    credits_spent_atomic: creditsSpentAtomic.toString(),
    custodial_float_atomic: custodialFloatAtomic.toString(),
    custodial_float_usd: fromAtomicUnits(custodialFloatAtomic.toString(), USDC_DECIMALS),
    refund_owed_count: summary.settledCount + summary.provisionFailedCount,
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
    if (context.req.header("x-admin-token") !== config.adminToken) {
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
      },
      reconciliation: buildReconciliation(summary),
      nosana_credits: balanceResult.ok
        ? {
            assigned_cents: balanceResult.value.assignedCents,
            reserved_cents: balanceResult.value.reservedCents,
            settled_cents: balanceResult.value.settledCents,
            available_cents: balanceResult.value.availableCents,
          }
        : { error: balanceResult.reason },
    });
  });

  return adminRouter;
};
