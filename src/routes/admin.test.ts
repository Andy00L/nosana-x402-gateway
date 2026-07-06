import { describe, expect, test } from "bun:test";
import { createAdminRouter } from "./admin.js";
import { createSettlementStore } from "../lib/settlementStore.js";
import { ok, err, type Result } from "../lib/result.js";
import type { CreditsBalance } from "../lib/provisioning.js";

const IN_MEMORY_DB = ":memory:";

// A settlement store seeded with: one provisioned rental (43600 atomic),
// one provision_failed (10000 atomic, a refund owed). So usdcIn = 53600,
// creditsSpent = 43600, custodialFloat = 10000.
const buildSeededStore = () => {
  const store = createSettlementStore(IN_MEMORY_DB);
  store.reservePayment("prov-1", {
    marketSlug: "nvidia-3060",
    durationMinutes: 60,
    amountAtomic: "43600",
  });
  store.markSettled("prov-1", "tx-prov-1", "payer-1");
  store.markProvisioned("prov-1", "dep-1");

  store.reservePayment("fail-1", {
    marketSlug: "nvidia-3060",
    durationMinutes: 60,
    amountAtomic: "10000",
  });
  store.markSettled("fail-1", "tx-fail-1", "payer-2");
  store.markProvisionFailed("fail-1", null);
  return store;
};

const okBalance = (): Result<CreditsBalance> =>
  ok({ assignedUsd: 100, reservedUsd: 0, settledUsd: 40, availableUsd: 60 });

const buildRouter = (
  adminToken: string | undefined,
  creditsBalance: () => Promise<Result<CreditsBalance>>,
) =>
  createAdminRouter({
    config: { adminToken },
    settlementStore: buildSeededStore(),
    creditsSource: { getCreditsBalance: creditsBalance },
  });

describe("createAdminRouter", () => {
  test("returns 404 when no admin token is configured", async () => {
    const router = buildRouter(undefined, async () => okBalance());
    const response = await router.request("/ledger");
    expect(response.status).toBe(404);
  });

  test("returns 401 when the admin token does not match", async () => {
    const router = buildRouter("right-token", async () => okBalance());
    const response = await router.request("/ledger", {
      headers: { "x-admin-token": "wrong-token" },
    });
    expect(response.status).toBe(401);
  });

  test("returns reconciliation numbers with a valid token", async () => {
    const router = buildRouter("right-token", async () => okBalance());
    const response = await router.request("/ledger", {
      headers: { "x-admin-token": "right-token" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      reconciliation: {
        usdc_in_atomic: string;
        credits_spent_atomic: string;
        custodial_float_atomic: string;
        refund_owed_count: number;
      };
      nosana_credits: { available_usd: number };
    };
    // Identity holds exactly: usdcIn = creditsSpent + custodialFloat.
    expect(body.reconciliation.usdc_in_atomic).toBe("53600");
    expect(body.reconciliation.credits_spent_atomic).toBe("43600");
    expect(body.reconciliation.custodial_float_atomic).toBe("10000");
    expect(body.reconciliation.refund_owed_count).toBe(1);
    expect(body.nosana_credits.available_usd).toBe(60);
  });

  test("still serves the ledger when the credits balance is unreachable", async () => {
    const router = buildRouter("right-token", async () => err("credits balance check failed"));
    const response = await router.request("/ledger", {
      headers: { "x-admin-token": "right-token" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { nosana_credits: { error?: string } };
    expect(body.nosana_credits.error).toContain("credits balance check failed");
  });
});
