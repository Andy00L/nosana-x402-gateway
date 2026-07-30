import { describe, expect, test } from "bun:test";
import { reportRefundsOwed } from "./refundScan.js";
import { createSettlementStore } from "./settlementStore.js";

const IN_MEMORY_DB = ":memory:";

const QUOTE_INFO = {
  marketSlug: "test-market",
  durationMinutes: 60,
  amountAtomic: "10000",
};

describe("reportRefundsOwed", () => {
  test("returns nothing on a clean ledger", () => {
    const store = createSettlementStore(IN_MEMORY_DB);
    const report = reportRefundsOwed(store);
    expect(report.refundsOwed).toHaveLength(0);
    expect(report.staleReservations).toHaveLength(0);
  });

  test("returns every payment that settled without a deployment", () => {
    const store = createSettlementStore(IN_MEMORY_DB);
    store.reservePayment("fail-1", QUOTE_INFO);
    store.markSettled("fail-1", "tx-fail-1", "payer-1");
    store.markProvisionFailed("fail-1", null);

    store.reservePayment("ok-1", QUOTE_INFO);
    store.markSettled("ok-1", "tx-ok-1", "payer-2");
    store.markProvisioned("ok-1", "dep-1");

    const report = reportRefundsOwed(store);
    expect(report.refundsOwed).toHaveLength(1);
    expect(report.refundsOwed[0]?.txSignature).toBe("tx-fail-1");
    // A fresh reservation is normal in-flight state, never reported stale.
    expect(report.staleReservations).toHaveLength(0);
  });
});
