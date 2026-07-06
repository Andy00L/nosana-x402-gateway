import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Result, ok, err } from "./result.js";

// Payment lifecycle:
//   reserved -> settled -> provisioned | provision_failed
//   reserved -> settle_unknown   (settle transport error: money MAY have moved)
//   reserved -> settle_rejected  (facilitator explicitly refused: money did NOT move)
// A reservation row is only ever DELETED before settle is attempted (a capacity
// refusal, where no money moved). Once settle is attempted the row is never
// deleted: deleting it would reopen a replay window where a settle that landed
// on-chain but failed to return could be resubmitted and provision twice
// (security audit finding C1). settle_unknown is money possibly owed and is
// surfaced for reconciliation; settle_rejected moved no money. Persistent by
// design: a crash between settle and provision must survive a restart.
export type SettlementStatus =
  | "reserved"
  | "settled"
  | "provisioned"
  | "provision_failed"
  | "settle_unknown"
  | "settle_rejected";

export interface SettlementRecord {
  readonly paymentKey: string;
  readonly status: SettlementStatus;
  readonly txSignature: string | null;
  readonly payer: string | null;
  readonly marketSlug: string;
  readonly durationMinutes: number;
  readonly amountAtomic: string;
  readonly deploymentId: string | null;
}

// Per-status counts and atomic-unit totals, for reconciliation. Totals are
// strings because they are sums of USDC atomic units and must stay in integer
// precision (no float on money).
export interface LedgerSummary {
  readonly reservedCount: number;
  readonly settledCount: number;
  readonly settledAtomicTotal: string;
  readonly provisionedCount: number;
  readonly provisionedAtomicTotal: string;
  readonly provisionFailedCount: number;
  readonly provisionFailedAtomicTotal: string;
  readonly settleUnknownCount: number;
  readonly settleUnknownAtomicTotal: string;
  readonly settleRejectedCount: number;
  readonly settleRejectedAtomicTotal: string;
}

// The raw PAYMENT-SIGNATURE header embeds the signed transaction; storing its
// hash is enough for dedupe and keeps payment material out of the database.
export const hashPaymentHeader = (paymentHeader: string): string =>
  createHash("sha256").update(paymentHeader).digest("hex");

export interface SettlementStore {
  reservePayment: (
    paymentKey: string,
    quoteInfo: { marketSlug: string; durationMinutes: number; amountAtomic: string },
  ) => Result<void>;
  releaseReservation: (paymentKey: string) => void;
  markSettled: (paymentKey: string, txSignature: string, payer: string | null) => Result<void>;
  // Settle was attempted but its outcome is unknown (transport error/timeout):
  // money may have moved. Blocks replay of the same key and is surfaced as owed.
  markSettleUnknown: (paymentKey: string) => void;
  // Facilitator explicitly refused: no money moved. Blocks replay of the key.
  markSettleRejected: (paymentKey: string) => void;
  markProvisioned: (paymentKey: string, deploymentId: string) => void;
  markProvisionFailed: (paymentKey: string, deploymentId: string | null) => void;
  listPaidWithoutDeployment: () => SettlementRecord[];
  summarizeLedger: () => LedgerSummary;
}

interface SettlementRow {
  payment_key: string;
  status: SettlementStatus;
  tx_signature: string | null;
  payer: string | null;
  market_slug: string;
  duration_minutes: number;
  amount_atomic: string;
  deployment_id: string | null;
}

const mapRowToRecord = (row: SettlementRow): SettlementRecord => ({
  paymentKey: row.payment_key,
  status: row.status,
  txSignature: row.tx_signature,
  payer: row.payer,
  marketSlug: row.market_slug,
  durationMinutes: row.duration_minutes,
  amountAtomic: row.amount_atomic,
  deploymentId: row.deployment_id,
});

export const createSettlementStore = (databasePath: string): SettlementStore => {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  // WAL keeps writes durable without blocking concurrent reads.
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS settlements (
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
  `);

  const reservePayment: SettlementStore["reservePayment"] = (paymentKey, quoteInfo) => {
    // INSERT OR IGNORE is the atomic check-and-set: a second request carrying
    // the same payment header changes zero rows and is rejected as a replay.
    const insertResult = database
      .query(
        `INSERT OR IGNORE INTO settlements
           (payment_key, status, market_slug, duration_minutes, amount_atomic, created_at, updated_at)
         VALUES (?1, 'reserved', ?2, ?3, ?4, unixepoch(), unixepoch())`,
      )
      .run(paymentKey, quoteInfo.marketSlug, quoteInfo.durationMinutes, quoteInfo.amountAtomic);
    if (insertResult.changes === 0) {
      return err("this payment was already submitted to the gateway (replay)");
    }
    return ok(undefined);
  };

  const releaseReservation: SettlementStore["releaseReservation"] = (paymentKey) => {
    database
      .query(`DELETE FROM settlements WHERE payment_key = ?1 AND status = 'reserved'`)
      .run(paymentKey);
  };

  const markSettled: SettlementStore["markSettled"] = (paymentKey, txSignature, payer) => {
    try {
      database
        .query(
          `UPDATE settlements
             SET status = 'settled', tx_signature = ?2, payer = ?3, updated_at = unixepoch()
           WHERE payment_key = ?1 AND status = 'reserved'`,
        )
        .run(paymentKey, txSignature, payer);
      return ok(undefined);
    } catch (uniqueConstraintError) {
      // The UNIQUE index on tx_signature caught a second header carrying an
      // already-settled transaction.
      const message =
        uniqueConstraintError instanceof Error
          ? uniqueConstraintError.message
          : String(uniqueConstraintError);
      return err(`transaction signature already recorded (replay): ${message}`);
    }
  };

  const markSettleUnknown: SettlementStore["markSettleUnknown"] = (paymentKey) => {
    // From a reserved row only: the settle outcome is unknown, so we keep the
    // key (blocks replay) and flag it as owed. No tx signature is stored (we
    // either never got one or it collided with an already-settled key).
    database
      .query(
        `UPDATE settlements
           SET status = 'settle_unknown', updated_at = unixepoch()
         WHERE payment_key = ?1 AND status = 'reserved'`,
      )
      .run(paymentKey);
  };

  const markSettleRejected: SettlementStore["markSettleRejected"] = (paymentKey) => {
    database
      .query(
        `UPDATE settlements
           SET status = 'settle_rejected', updated_at = unixepoch()
         WHERE payment_key = ?1 AND status = 'reserved'`,
      )
      .run(paymentKey);
  };

  const markProvisioned: SettlementStore["markProvisioned"] = (paymentKey, deploymentId) => {
    database
      .query(
        `UPDATE settlements
           SET status = 'provisioned', deployment_id = ?2, updated_at = unixepoch()
         WHERE payment_key = ?1`,
      )
      .run(paymentKey, deploymentId);
  };

  const markProvisionFailed: SettlementStore["markProvisionFailed"] = (
    paymentKey,
    deploymentId,
  ) => {
    database
      .query(
        `UPDATE settlements
           SET status = 'provision_failed', deployment_id = ?2, updated_at = unixepoch()
         WHERE payment_key = ?1`,
      )
      .run(paymentKey, deploymentId);
  };

  const listPaidWithoutDeployment: SettlementStore["listPaidWithoutDeployment"] = () => {
    // Every state where money may have moved but no running deployment resulted:
    // settled (stuck between settle and provision), provision_failed, and
    // settle_unknown (settle outcome unresolved). settle_rejected moved no money
    // and is excluded.
    const rows = database
      .query(
        `SELECT payment_key, status, tx_signature, payer, market_slug,
                duration_minutes, amount_atomic, deployment_id
           FROM settlements
          WHERE status IN ('settled', 'provision_failed', 'settle_unknown')`,
      )
      .all() as SettlementRow[];
    return rows.map(mapRowToRecord);
  };

  const summarizeLedger: SettlementStore["summarizeLedger"] = () => {
    // SUM over CAST-to-INTEGER keeps money in integer units (no float on
    // money). SQLite INTEGER is 64-bit, exact up to about 9.2e18 atomic units
    // (about 9.2e12 USD), far above any realistic gateway volume.
    const rows = database
      .query(
        `SELECT status,
                COUNT(*) AS cnt,
                CAST(COALESCE(SUM(CAST(amount_atomic AS INTEGER)), 0) AS TEXT) AS total
           FROM settlements
          GROUP BY status`,
      )
      .all() as { status: SettlementStatus; cnt: number; total: string }[];
    const rowsByStatus = new Map(rows.map((row) => [row.status, row]));
    const countForStatus = (status: SettlementStatus): number =>
      rowsByStatus.get(status)?.cnt ?? 0;
    const totalForStatus = (status: SettlementStatus): string =>
      rowsByStatus.get(status)?.total ?? "0";
    return {
      reservedCount: countForStatus("reserved"),
      settledCount: countForStatus("settled"),
      settledAtomicTotal: totalForStatus("settled"),
      provisionedCount: countForStatus("provisioned"),
      provisionedAtomicTotal: totalForStatus("provisioned"),
      provisionFailedCount: countForStatus("provision_failed"),
      provisionFailedAtomicTotal: totalForStatus("provision_failed"),
      settleUnknownCount: countForStatus("settle_unknown"),
      settleUnknownAtomicTotal: totalForStatus("settle_unknown"),
      settleRejectedCount: countForStatus("settle_rejected"),
      settleRejectedAtomicTotal: totalForStatus("settle_rejected"),
    };
  };

  return {
    reservePayment,
    releaseReservation,
    markSettled,
    markSettleUnknown,
    markSettleRejected,
    markProvisioned,
    markProvisionFailed,
    listPaidWithoutDeployment,
    summarizeLedger,
  };
};
