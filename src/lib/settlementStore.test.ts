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
});
