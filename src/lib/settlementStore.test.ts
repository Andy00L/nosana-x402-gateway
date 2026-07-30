import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync } from "node:fs";
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

describe("markRefunded", () => {
  const REFUND_TX = "refund-tx-signature-1";

  test("closes a provision_failed row and removes it from the owed list", () => {
    const store = createSettlementStore(IN_MEMORY_DB);
    store.reservePayment("key-1", QUOTE_INFO);
    store.markSettled("key-1", "tx-sig-1", "payer-1");
    store.markProvisionFailed("key-1", null);
    expect(store.markRefunded("key-1", REFUND_TX).ok).toBe(true);
    expect(store.listPaidWithoutDeployment()).toHaveLength(0);
    const summary = store.summarizeLedger();
    expect(summary.refundedCount).toBe(1);
    expect(summary.refundedAtomicTotal).toBe(QUOTE_INFO.amountAtomic);
    // The payment key stays in the table: the original header can never be
    // replayed after the refund.
    expect(store.reservePayment("key-1", QUOTE_INFO).ok).toBe(false);
  });

  test("closes settled and settle_unknown rows too", () => {
    const store = createSettlementStore(IN_MEMORY_DB);
    store.reservePayment("stuck-1", QUOTE_INFO);
    store.markSettled("stuck-1", "tx-stuck-1", "payer-1");
    expect(store.markRefunded("stuck-1", "refund-tx-a").ok).toBe(true);

    store.reservePayment("unknown-1", QUOTE_INFO);
    store.markSettleUnknown("unknown-1");
    expect(store.markRefunded("unknown-1", "refund-tx-b").ok).toBe(true);

    expect(store.listPaidWithoutDeployment()).toHaveLength(0);
  });

  test("refuses an unknown payment key as not_found", () => {
    const store = createSettlementStore(IN_MEMORY_DB);
    const refused = store.markRefunded("no-such-key", REFUND_TX);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason.code).toBe("not_found");
    }
  });

  test("refuses the same refund tx against a second owed payment", () => {
    const store = createSettlementStore(IN_MEMORY_DB);
    store.reservePayment("key-1", QUOTE_INFO);
    store.markSettled("key-1", "tx-sig-1", "payer-1");
    store.markProvisionFailed("key-1", null);
    store.reservePayment("key-2", QUOTE_INFO);
    store.markSettled("key-2", "tx-sig-2", "payer-2");
    store.markProvisionFailed("key-2", null);

    expect(store.markRefunded("key-1", REFUND_TX).ok).toBe(true);
    // One transfer cannot close two owed rows (audit A4): the second row
    // must stay owed instead of silently sharing the first row's refund.
    const duplicate = store.markRefunded("key-2", REFUND_TX);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.reason.code).toBe("duplicate_refund_tx");
    }
    expect(store.listPaidWithoutDeployment()).toHaveLength(1);
  });

  test("a fresh reservation cannot be marked refunded (settle may be in flight)", () => {
    const store = createSettlementStore(IN_MEMORY_DB);
    store.reservePayment("key-1", QUOTE_INFO);
    const refused = store.markRefunded("key-1", REFUND_TX);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason.code).toBe("not_refundable");
    }
  });

  test("refuses a provisioned rental and a double mark as not_refundable", () => {
    const store = createSettlementStore(IN_MEMORY_DB);
    store.reservePayment("key-1", QUOTE_INFO);
    store.markSettled("key-1", "tx-sig-1", "payer-1");
    store.markProvisioned("key-1", "dep-1");
    const provisionedRefusal = store.markRefunded("key-1", REFUND_TX);
    expect(provisionedRefusal.ok).toBe(false);
    if (!provisionedRefusal.ok) {
      expect(provisionedRefusal.reason.code).toBe("not_refundable");
      expect(provisionedRefusal.reason.message).toContain("provisioned");
    }

    store.reservePayment("key-2", QUOTE_INFO);
    store.markSettled("key-2", "tx-sig-2", "payer-2");
    store.markProvisionFailed("key-2", null);
    expect(store.markRefunded("key-2", REFUND_TX).ok).toBe(true);
    const doubleMark = store.markRefunded("key-2", REFUND_TX);
    expect(doubleMark.ok).toBe(false);
    if (!doubleMark.ok) {
      expect(doubleMark.reason.code).toBe("not_refundable");
    }
  });

  test("surfaces a reservation stuck mid-settle and lets it close after reconciliation", () => {
    const STALE_DB_PATH = ".scratch/settlement-stale-test.db";
    mkdirSync(".scratch", { recursive: true });
    rmSync(STALE_DB_PATH, { force: true });
    try {
      const store = createSettlementStore(STALE_DB_PATH);
      store.reservePayment("stale-1", QUOTE_INFO);
      store.reservePayment("fresh-1", QUOTE_INFO);
      // Backdate one reservation past the stale threshold, as if the process
      // had died mid-settle an hour ago.
      const rawDatabase = new Database(STALE_DB_PATH);
      rawDatabase
        .query(
          `UPDATE settlements SET created_at = created_at - 3600 WHERE payment_key = 'stale-1'`,
        )
        .run();
      rawDatabase.close();

      const staleReservations = store.listStaleReservations();
      expect(staleReservations).toHaveLength(1);
      expect(staleReservations[0]?.paymentKey).toBe("stale-1");
      // After reconciling on-chain, the operator can close the stale row as
      // refunded; the fresh one stays untouchable (settle may be in flight).
      expect(store.markRefunded("stale-1", REFUND_TX).ok).toBe(true);
      expect(store.listStaleReservations()).toHaveLength(0);
      expect(store.markRefunded("fresh-1", "another-refund-tx").ok).toBe(false);
    } finally {
      rmSync(STALE_DB_PATH, { force: true });
      rmSync(`${STALE_DB_PATH}-wal`, { force: true });
      rmSync(`${STALE_DB_PATH}-shm`, { force: true });
    }
  });

  test("migrates a database created before the refund column existed", () => {
    // The live ledger predates refund_tx_signature; prove the PRAGMA-guarded
    // ALTER upgrades the old schema in place. A file (not :memory:) is needed
    // so the pre-seeded old-schema table survives into createSettlementStore.
    const LEGACY_DB_PATH = ".scratch/settlement-migration-test.db";
    mkdirSync(".scratch", { recursive: true });
    rmSync(LEGACY_DB_PATH, { force: true });
    try {
      const legacyDatabase = new Database(LEGACY_DB_PATH);
      legacyDatabase.exec(`
        CREATE TABLE settlements (
          payment_key      TEXT PRIMARY KEY,
          status           TEXT NOT NULL,
          tx_signature     TEXT UNIQUE,
          payer            TEXT,
          market_slug      TEXT NOT NULL,
          duration_minutes INTEGER NOT NULL,
          amount_atomic    TEXT NOT NULL,
          deployment_id    TEXT,
          created_at       INTEGER NOT NULL,
          updated_at       INTEGER NOT NULL
        );
        INSERT INTO settlements
          (payment_key, status, tx_signature, payer, market_slug,
           duration_minutes, amount_atomic, created_at, updated_at)
        VALUES
          ('legacy-1', 'provision_failed', 'tx-legacy-1', 'payer-legacy',
           'test-market', 60, '727', unixepoch(), unixepoch());
      `);
      legacyDatabase.close();

      const store = createSettlementStore(LEGACY_DB_PATH);
      const owed = store.listPaidWithoutDeployment();
      expect(owed).toHaveLength(1);
      expect(owed[0]?.refundTxSignature).toBeNull();
      expect(store.markRefunded("legacy-1", REFUND_TX).ok).toBe(true);
      expect(store.listPaidWithoutDeployment()).toHaveLength(0);
    } finally {
      rmSync(LEGACY_DB_PATH, { force: true });
      rmSync(`${LEGACY_DB_PATH}-wal`, { force: true });
      rmSync(`${LEGACY_DB_PATH}-shm`, { force: true });
    }
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
      refundedCount: 0,
      refundedAtomicTotal: "0",
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
