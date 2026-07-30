import { describe, expect, test } from "bun:test";
import { getDefaultTokenAsset } from "x402-solana/utils";
import { createAdminRouter } from "./admin.js";
import { createSettlementStore, type SettlementStore } from "../lib/settlementStore.js";
import { ok, err, type Result } from "../lib/result.js";
import type { CreditsBalance } from "../lib/provisioning.js";

const IN_MEMORY_DB = ":memory:";

// Base58, 87 chars: shaped like a real Solana tx signature so it passes the
// isPlausibleSignature gate on the mark-refunded route.
const PLAUSIBLE_REFUND_TX = "5".repeat(87);

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
  settlementStore: SettlementStore = buildSeededStore(),
) =>
  createAdminRouter({
    config: { adminToken, x402Network: "solana-devnet" },
    settlementStore,
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

describe("admin refunds", () => {
  const AUTH_HEADERS = { "x-admin-token": "right-token" };

  test("the refund routes are gated exactly like the ledger", async () => {
    const hiddenRouter = buildRouter(undefined, async () => okBalance());
    expect((await hiddenRouter.request("/refunds")).status).toBe(404);

    const router = buildRouter("right-token", async () => okBalance());
    expect((await router.request("/refunds")).status).toBe(401);
    const markResponse = await router.request("/refunds/fail-1/mark-refunded", {
      method: "POST",
      headers: { "x-admin-token": "wrong-token" },
    });
    expect(markResponse.status).toBe(401);
  });

  test("lists each refund owed with a ready-to-run spl-token command", async () => {
    const router = buildRouter("right-token", async () => okBalance());
    const response = await router.request("/refunds", { headers: AUTH_HEADERS });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      refunds: Array<{
        payment_key: string;
        payer: string | null;
        amount_atomic: string;
        refund_command: string | null;
      }>;
      stale_reservations: unknown[];
      how_to: string;
    };
    // Only the provision_failed record is owed; the provisioned one is not,
    // and no reservation in this ledger is old enough to be stale.
    expect(body.refunds).toHaveLength(1);
    expect(body.stale_reservations).toHaveLength(0);
    const owed = body.refunds[0];
    expect(owed?.payment_key).toBe("fail-1");
    // 10000 atomic at 6 decimals is exactly 0.01 USDC, string-formatted.
    const devnetUsdcMint = getDefaultTokenAsset("solana-devnet").address;
    expect(owed?.refund_command).toBe(
      `spl-token transfer ${devnetUsdcMint} 0.01 payer-2 --fund-recipient`,
    );
    expect(body.how_to).toContain("mark-refunded");
  });

  test("omits the command when the payer is unknown", async () => {
    const store = createSettlementStore(IN_MEMORY_DB);
    store.reservePayment("anon-1", {
      marketSlug: "nvidia-3060",
      durationMinutes: 60,
      amountAtomic: "727",
    });
    store.markSettled("anon-1", "tx-anon-1", null);
    store.markProvisionFailed("anon-1", null);
    const router = buildRouter("right-token", async () => okBalance(), store);
    const response = await router.request("/refunds", { headers: AUTH_HEADERS });
    const body = (await response.json()) as {
      refunds: Array<{ refund_command: string | null }>;
    };
    expect(body.refunds[0]?.refund_command).toBeNull();
  });

  test("mark-refunded validates the signature shape", async () => {
    const router = buildRouter("right-token", async () => okBalance());
    const response = await router.request("/refunds/fail-1/mark-refunded", {
      method: "POST",
      headers: { ...AUTH_HEADERS, "content-type": "application/json" },
      body: JSON.stringify({ refund_tx_signature: "not-base58-0OIl" }),
    });
    expect(response.status).toBe(400);
  });

  test("mark-refunded closes the row and distinguishes 404 from 409", async () => {
    const store = buildSeededStore();
    const router = buildRouter("right-token", async () => okBalance(), store);
    const markRequest = (paymentKey: string) =>
      router.request(`/refunds/${paymentKey}/mark-refunded`, {
        method: "POST",
        headers: { ...AUTH_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({ refund_tx_signature: PLAUSIBLE_REFUND_TX }),
      });

    // Unknown key and a rental that was delivered are refused distinctly.
    expect((await markRequest("no-such-key")).status).toBe(404);
    expect((await markRequest("prov-1")).status).toBe(409);

    const marked = await markRequest("fail-1");
    expect(marked.status).toBe(200);
    // The owed list is empty and the money moved to the refunded bucket.
    const refundsAfter = await router.request("/refunds", { headers: AUTH_HEADERS });
    const refundsBody = (await refundsAfter.json()) as { refunds: unknown[] };
    expect(refundsBody.refunds).toHaveLength(0);
    const ledgerAfter = await router.request("/ledger", { headers: AUTH_HEADERS });
    const ledgerBody = (await ledgerAfter.json()) as {
      reconciliation: {
        usdc_in_atomic: string;
        custodial_float_atomic: string;
        refunded_atomic: string;
        refund_owed_count: number;
      };
    };
    // Identity still holds: usdcIn = creditsSpent + custodialFloat + refunded.
    expect(ledgerBody.reconciliation.usdc_in_atomic).toBe("53600");
    expect(ledgerBody.reconciliation.custodial_float_atomic).toBe("0");
    expect(ledgerBody.reconciliation.refunded_atomic).toBe("10000");
    expect(ledgerBody.reconciliation.refund_owed_count).toBe(0);

    // Double mark is a conflict, not a silent success.
    expect((await markRequest("fail-1")).status).toBe(409);
  });
});
