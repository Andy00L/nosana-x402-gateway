import { describe, expect, test } from "bun:test";
import type { PaymentRequirements, SettleResponse, VerifyResponse } from "x402-solana/server";
import { collectPayment, type PaymentFlowDependencies } from "./paymentFlow.js";
import { createSettlementStore } from "./settlementStore.js";
import type { PaymentFacilitatorClient } from "./x402.js";
import type { ProvisioningService } from "./provisioning.js";
import type { RentQuote } from "./pricing.js";
import { ok, err } from "./result.js";

// 88 base58 chars: passes the gateway's plausible-signature check.
const PLAUSIBLE_SIGNATURE = "5".repeat(88);
const TEST_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

const OK_SETTLE: SettleResponse = {
  success: true,
  transaction: PLAUSIBLE_SIGNATURE,
  network: TEST_NETWORK,
  payer: "payer-pubkey",
};

const TEST_REQUIREMENTS: PaymentRequirements = {
  scheme: "exact",
  network: TEST_NETWORK,
  asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  amount: "10000",
  payTo: "7BF8eaGq9hgJGQcauqZyDwkfF9ZViHomwvnLnjw7ABLw",
  maxTimeoutSeconds: 300,
  extra: {},
};

const TEST_QUOTE: RentQuote = {
  amountAtomic: "10000",
  amountUsd: 0.01,
  durationMinutes: 60,
  market: {
    address: "9MGKqixvtLJgL46Bp38ZrD3MxTMRt57VL3rQtQY64zj4",
    slug: "scenario-test-dm",
    name: "Scenario test",
    usdRewardPerHour: 0.01,
    networkFeePercentage: 10,
    type: "COMMUNITY",
  },
};

const buildFacilitator = (options: {
  verify?: () => Promise<VerifyResponse>;
  settle?: () => Promise<SettleResponse>;
}): PaymentFacilitatorClient => ({
  verifyPayment: options.verify ?? (async () => ({ isValid: true, payer: "payer-pubkey" })),
  settlePayment: options.settle ?? (async () => OK_SETTLE),
});

const coveringProvisioning: Pick<ProvisioningService, "isConfigured" | "checkCreditsCoverQuote"> = {
  isConfigured: true,
  checkCreditsCoverQuote: async () => ok(undefined),
};

const buildDeps = (
  facilitator: PaymentFacilitatorClient,
  provisioning: Pick<ProvisioningService, "isConfigured" | "checkCreditsCoverQuote">,
): { deps: PaymentFlowDependencies; store: ReturnType<typeof createSettlementStore> } => {
  const store = createSettlementStore(":memory:");
  return {
    store,
    deps: { x402Handler: facilitator, settlementStore: store, provisioningService: provisioning },
  };
};

describe("collectPayment", () => {
  test("happy path settles and returns the transaction signature", async () => {
    const { deps, store } = buildDeps(buildFacilitator({}), coveringProvisioning);
    const result = await collectPayment(deps, "header-ok", TEST_REQUIREMENTS, TEST_QUOTE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.txSignature).toBe(PLAUSIBLE_SIGNATURE);
      expect(result.value.payer).toBe("payer-pubkey");
    }
    // Left in 'settled' awaiting the caller's provisioning step.
    expect(store.listPaidWithoutDeployment()).toHaveLength(1);
  });

  test("C1 regression: a settle transport error keeps the reservation and blocks replay", async () => {
    const facilitator = buildFacilitator({
      settle: async () => {
        throw new Error("connection reset");
      },
    });
    const { deps, store } = buildDeps(facilitator, coveringProvisioning);

    const first = await collectPayment(deps, "header-H", TEST_REQUIREMENTS, TEST_QUOTE);
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.reason.status).toBe(502);
    }
    // Money may have moved on-chain: it must be flagged as owed, not deleted.
    const owed = store.listPaidWithoutDeployment();
    expect(owed).toHaveLength(1);
    expect(owed[0]?.status).toBe("settle_unknown");

    // The same header must NOT be able to provision a second time.
    const replay = await collectPayment(deps, "header-H", TEST_REQUIREMENTS, TEST_QUOTE);
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.reason.status).toBe(409);
    }
  });

  test("an explicit settle rejection records settle_rejected (no money) and blocks replay", async () => {
    const facilitator = buildFacilitator({
      settle: async () => ({
        success: false,
        errorReason: "insufficient_funds",
        transaction: "",
        network: TEST_NETWORK,
      }),
    });
    const { deps, store } = buildDeps(facilitator, coveringProvisioning);
    const result = await collectPayment(deps, "header-reject", TEST_REQUIREMENTS, TEST_QUOTE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.status).toBe(402);
    }
    // No money moved, so not owed, but the key is retained against replay.
    expect(store.listPaidWithoutDeployment()).toHaveLength(0);
    const replay = await collectPayment(deps, "header-reject", TEST_REQUIREMENTS, TEST_QUOTE);
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.reason.status).toBe(409);
    }
  });

  test("settle success with an implausible signature is not trusted and is flagged owed", async () => {
    const facilitator = buildFacilitator({
      settle: async () => ({ success: true, transaction: "", network: TEST_NETWORK }),
    });
    const { deps, store } = buildDeps(facilitator, coveringProvisioning);
    const result = await collectPayment(deps, "header-badsig", TEST_REQUIREMENTS, TEST_QUOTE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.status).toBe(502);
    }
    const owed = store.listPaidWithoutDeployment();
    expect(owed).toHaveLength(1);
    expect(owed[0]?.status).toBe("settle_unknown");
  });

  test("an invalid payment is rejected before any reservation", async () => {
    const facilitator = buildFacilitator({
      verify: async () => ({ isValid: false, invalidReason: "bad_signature" }),
    });
    const { deps, store } = buildDeps(facilitator, coveringProvisioning);
    const result = await collectPayment(deps, "header-invalid", TEST_REQUIREMENTS, TEST_QUOTE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.status).toBe(402);
    }
    expect(store.listPaidWithoutDeployment()).toHaveLength(0);
  });

  test("a capacity refusal (pre-settle) safely releases so the header can retry later", async () => {
    const store = createSettlementStore(":memory:");
    let creditsAvailable = false;
    const provisioning: Pick<ProvisioningService, "isConfigured" | "checkCreditsCoverQuote"> = {
      isConfigured: true,
      checkCreditsCoverQuote: async () =>
        creditsAvailable ? ok(undefined) : err("cannot cover this rental"),
    };
    const deps: PaymentFlowDependencies = {
      x402Handler: buildFacilitator({}),
      settlementStore: store,
      provisioningService: provisioning,
    };

    const refused = await collectPayment(deps, "header-cap", TEST_REQUIREMENTS, TEST_QUOTE);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason.status).toBe(503);
    }
    // No money moved: nothing owed and the reservation was released.
    expect(store.listPaidWithoutDeployment()).toHaveLength(0);

    // Capacity frees up; the same header now flows through (release was safe).
    creditsAvailable = true;
    const retried = await collectPayment(deps, "header-cap", TEST_REQUIREMENTS, TEST_QUOTE);
    expect(retried.ok).toBe(true);
  });
});
