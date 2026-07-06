import { describe, expect, test } from "bun:test";
import { createSettlementStore, hashPaymentHeader } from "./settlementStore.js";

// bun:sqlite accepts ":memory:" so each store below is isolated and leaves
// no file behind.
const IN_MEMORY_DB = ":memory:";

const QUOTE_INFO = {
  marketSlug: "test-market",
  durationMinutes: 60,
  amountAtomic: "10000",
};

describe("hashPaymentHeader", () => {
  test("is deterministic and does not echo the header", () => {
    const header = "payment-header-carrying-a-signed-transaction";
    const firstHash = hashPaymentHeader(header);
    expect(firstHash).toBe(hashPaymentHeader(header));
    expect(firstHash).toHaveLength(64);
    expect(firstHash).not.toContain("payment");
  });
});

describe("createSettlementStore", () => {
  test("reserves a payment once and rejects the replay", () => {
    const store = createSettlementStore(IN_MEMORY_DB);
    expect(store.reservePayment("key-1", QUOTE_INFO).ok).toBe(true);
    const replay = store.reservePayment("key-1", QUOTE_INFO);
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.reason).toContain("replay");
    }
  });

  test("released reservation can be reserved again (settle retry path)", () => {
    const store = createSettlementStore(IN_MEMORY_DB);
    expect(store.reservePayment("key-1", QUOTE_INFO).ok).toBe(true);
    store.releaseReservation("key-1");
    expect(store.reservePayment("key-1", QUOTE_INFO).ok).toBe(true);
  });

  test("release only removes reservations, never settled records", () => {
    const store = createSettlementStore(IN_MEMORY_DB);
    store.reservePayment("key-1", QUOTE_INFO);
    store.markSettled("key-1", "tx-sig-1", "payer-1");
    store.releaseReservation("key-1");
    // Still present: a settled payment with no deployment is a refund owed.
    expect(store.listPaidWithoutDeployment()).toHaveLength(1);
  });

  test("rejects a second payment key carrying an already-settled tx signature", () => {
    const store = createSettlementStore(IN_MEMORY_DB);
    store.reservePayment("key-1", QUOTE_INFO);
    expect(store.markSettled("key-1", "tx-sig-1", "payer-1").ok).toBe(true);
    store.reservePayment("key-2", QUOTE_INFO);
    const duplicate = store.markSettled("key-2", "tx-sig-1", "payer-1");
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.reason).toContain("replay");
    }
  });

  test("provisioned payments leave the refund list", () => {
    const store = createSettlementStore(IN_MEMORY_DB);
    store.reservePayment("key-1", QUOTE_INFO);
    store.markSettled("key-1", "tx-sig-1", "payer-1");
    expect(store.listPaidWithoutDeployment()).toHaveLength(1);
    store.markProvisioned("key-1", "deployment-1");
    expect(store.listPaidWithoutDeployment()).toHaveLength(0);
  });

  test("provision failures stay on the refund list with their record", () => {
    const store = createSettlementStore(IN_MEMORY_DB);
    store.reservePayment("key-1", QUOTE_INFO);
    store.markSettled("key-1", "tx-sig-1", "payer-1");
    store.markProvisionFailed("key-1", null);
    const refundsOwed = store.listPaidWithoutDeployment();
    expect(refundsOwed).toHaveLength(1);
    const refundRecord = refundsOwed[0];
    expect(refundRecord?.status).toBe("provision_failed");
    expect(refundRecord?.txSignature).toBe("tx-sig-1");
    expect(refundRecord?.amountAtomic).toBe("10000");
  });

  test("a plain reservation is not a refund owed", () => {
    const store = createSettlementStore(IN_MEMORY_DB);
    store.reservePayment("key-1", QUOTE_INFO);
    expect(store.listPaidWithoutDeployment()).toHaveLength(0);
  });

  test("settle_unknown is surfaced as owed and blocks replay of the same key", () => {
    const store = createSettlementStore(IN_MEMORY_DB);
    store.reservePayment("key-1", QUOTE_INFO);
    store.markSettleUnknown("key-1");
    // Money may have moved: it must appear as a refund/reconciliation owed.
    const owed = store.listPaidWithoutDeployment();
    expect(owed).toHaveLength(1);
    expect(owed[0]?.status).toBe("settle_unknown");
    // The key is not released, so the same header cannot be resubmitted (C1).
    expect(store.reservePayment("key-1", QUOTE_INFO).ok).toBe(false);
  });

  test("settle_rejected moved no money: not owed, but still blocks replay", () => {
    const store = createSettlementStore(IN_MEMORY_DB);
    store.reservePayment("key-1", QUOTE_INFO);
    store.markSettleRejected("key-1");
    expect(store.listPaidWithoutDeployment()).toHaveLength(0);
    expect(store.reservePayment("key-1", QUOTE_INFO).ok).toBe(false);
  });
});

describe("summarizeLedger", () => {
  test("an empty ledger is all zeros", () => {
    const summary = createSettlementStore(IN_MEMORY_DB).summarizeLedger();
    expect(summary).toEqual({
      reservedCount: 0,
      settledCount: 0,
      settledAtomicTotal: "0",
      provisionedCount: 0,
      provisionedAtomicTotal: "0",
      provisionFailedCount: 0,
      provisionFailedAtomicTotal: "0",
      settleUnknownCount: 0,
      settleUnknownAtomicTotal: "0",
      settleRejectedCount: 0,
      settleRejectedAtomicTotal: "0",
    });
  });

  test("counts and sums each status in integer atomic units", () => {
    const store = createSettlementStore(IN_MEMORY_DB);
    // Two provisioned (10000 + 43600), one provision_failed (10000),
    // one settled-and-stuck (2040000), one bare reservation (no money moved).
    store.reservePayment("prov-1", { ...QUOTE_INFO, amountAtomic: "10000" });
    store.markSettled("prov-1", "tx-1", "payer-1");
    store.markProvisioned("prov-1", "dep-1");

    store.reservePayment("prov-2", { ...QUOTE_INFO, amountAtomic: "43600" });
    store.markSettled("prov-2", "tx-2", "payer-2");
    store.markProvisioned("prov-2", "dep-2");

    store.reservePayment("fail-1", { ...QUOTE_INFO, amountAtomic: "10000" });
    store.markSettled("fail-1", "tx-3", "payer-3");
    store.markProvisionFailed("fail-1", null);

    store.reservePayment("stuck-1", { ...QUOTE_INFO, amountAtomic: "2040000" });
    store.markSettled("stuck-1", "tx-4", "payer-4");

    store.reservePayment("held-1", { ...QUOTE_INFO, amountAtomic: "99999" });

    const summary = store.summarizeLedger();
    expect(summary.provisionedCount).toBe(2);
    expect(summary.provisionedAtomicTotal).toBe("53600");
    expect(summary.provisionFailedCount).toBe(1);
    expect(summary.provisionFailedAtomicTotal).toBe("10000");
    expect(summary.settledCount).toBe(1);
    expect(summary.settledAtomicTotal).toBe("2040000");
    expect(summary.reservedCount).toBe(1);
  });

  test("keeps precision above the float-safe integer limit", () => {
    const store = createSettlementStore(IN_MEMORY_DB);
    // Two rows each above Number.MAX_SAFE_INTEGER; a REAL SUM would drift.
    const largeAtomic = "9007199254740993"; // 2^53 + 1
    store.reservePayment("big-1", { ...QUOTE_INFO, amountAtomic: largeAtomic });
    store.markSettled("big-1", "tx-b1", "payer-b1");
    store.markProvisioned("big-1", "dep-b1");
    store.reservePayment("big-2", { ...QUOTE_INFO, amountAtomic: largeAtomic });
    store.markSettled("big-2", "tx-b2", "payer-b2");
    store.markProvisioned("big-2", "dep-b2");
    const summary = store.summarizeLedger();
    expect(summary.provisionedAtomicTotal).toBe("18014398509481986"); // exact 2 * (2^53 + 1)
  });
});
