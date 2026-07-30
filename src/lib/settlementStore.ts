import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Result, ok, err } from "./result.js";

// Payment lifecycle:
//   reserved -> settled -> provisioned | provision_failed
//   reserved -> settle_unknown   (settle transport error: money MAY have moved)
//   reserved -> settle_rejected  (facilitator explicitly refused: money did NOT move)
//   settled | provision_failed | settle_unknown -> refunded
//     (the operator sent the USDC back and recorded the refund tx via the
//      admin refund route; a reservation stuck past STALE_RESERVATION_SECONDS
//      qualifies too, after on-chain reconciliation)
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
  | "settle_rejected"
  | "refunded";

// The only statuses a refund can be recorded from: every state where money
// moved (or may have moved) without a delivered deployment. Shared by
// markRefunded and listPaidWithoutDeployment so the two can never disagree on
// what counts as owed.
const REFUNDABLE_STATUSES = ["settled", "provision_failed", "settle_unknown"] as const;

// Age in seconds past which a 'reserved' row is suspicious. A reservation
// lives from reserve to the settle result: at worst the credits check (60s,
// provisioning.ts) plus settle (60s, x402.ts), about two minutes. One this
// old means the process died mid-settle, so the settle outcome is unknown and
// money may have moved even though the row never reached a settled status
// (audit A3). Surfaced by listStaleReservations for manual on-chain
// reconciliation; 900s keeps a wide margin over the two-minute worst case.
export const STALE_RESERVATION_SECONDS = 900;

export interface SettlementRecord {
  readonly paymentKey: string;
  readonly status: SettlementStatus;
  readonly txSignature: string | null;
  readonly payer: string | null;
  readonly marketSlug: string;
  readonly durationMinutes: number;
  readonly amountAtomic: string;
  readonly deploymentId: string | null;
  // Signature of the operator's refund transfer, recorded when the row moves
  // to 'refunded'. Null in every other status.
  readonly refundTxSignature: string | null;
}

// Why markRefunded failed, so the admin route can answer 404 (no such
// payment) and 409 (exists but not awaiting a refund, or the refund tx is
// already recorded elsewhere) distinctly (REFERENCE_SECURITY_AUDIT.md
// always-on rule 8).
export interface MarkRefundedFailure {
  readonly code: "not_found" | "not_refundable" | "duplicate_refund_tx";
  readonly message: string;
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
  readonly refundedCount: number;
  readonly refundedAtomicTotal: string;
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
  // The operator sent the USDC back: record the refund tx and close the row.
  // Only valid from a status where money was owed (or a stale reservation,
  // reconciled on-chain first); the payment key stays in the table so the
  // original header can never be replayed.
  markRefunded: (
    paymentKey: string,
    refundTxSignature: string,
  ) => Result<void, MarkRefundedFailure>;
  listPaidWithoutDeployment: () => SettlementRecord[];
  // Reservations older than STALE_RESERVATION_SECONDS: the process died
  // mid-settle, so money MAY have moved without the row ever leaving
  // 'reserved'. Needs manual on-chain reconciliation (audit A3).
  listStaleReservations: () => SettlementRecord[];
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
  refund_tx_signature: string | null;
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
  refundTxSignature: row.refund_tx_signature,
});

export const createSettlementStore = (databasePath: string): SettlementStore => {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  // WAL keeps writes durable without blocking concurrent reads.
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS settlements (
      payment_key         TEXT PRIMARY KEY,
      status              TEXT NOT NULL,
      tx_signature        TEXT UNIQUE,
      payer               TEXT,
      market_slug         TEXT NOT NULL,
      duration_minutes    INTEGER NOT NULL,
      amount_atomic       TEXT NOT NULL,
      deployment_id       TEXT,
      refund_tx_signature TEXT,
      created_at          INTEGER NOT NULL,
      updated_at          INTEGER NOT NULL
    );
  `);
  // In-place migration for databases created before the refund column existed
  // (the live ledger predates it and CREATE TABLE IF NOT EXISTS never alters
  // an existing table). PRAGMA-guarded so reopening is idempotent.
  const existingColumns = database
    .query(`PRAGMA table_info(settlements)`)
    .all() as { name: string }[];
  if (!existingColumns.some((column) => column.name === "refund_tx_signature")) {
    database.exec(`ALTER TABLE settlements ADD COLUMN refund_tx_signature TEXT;`);
  }
  // One refund transfer closes exactly one owed payment: without this, the
  // same refund tx could be recorded against two rows and hide an unpaid
  // refund (audit A4). Partial so the NULLs of every non-refunded row do not
  // collide.
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS settlements_refund_tx_unique
      ON settlements(refund_tx_signature)
      WHERE refund_tx_signature IS NOT NULL;
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

  // Both outcome marks step only from 'settled' (the callers settle first,
  // always); the guard makes a stray call on a refunded or rejected row a
  // no-op instead of a silent state overwrite (audit A6). A no-op surfaces in
  // reconciliation rather than corrupting the ledger.
  const markProvisioned: SettlementStore["markProvisioned"] = (paymentKey, deploymentId) => {
    database
      .query(
        `UPDATE settlements
           SET status = 'provisioned', deployment_id = ?2, updated_at = unixepoch()
         WHERE payment_key = ?1 AND status = 'settled'`,
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
         WHERE payment_key = ?1 AND status = 'settled'`,
      )
      .run(paymentKey, deploymentId);
  };

  const markRefunded: SettlementStore["markRefunded"] = (paymentKey, refundTxSignature) => {
    // The WHERE clause is the atomic guard: only a status where money is owed
    // can move to 'refunded', so a double mark (or a mark on a provisioned
    // rental) changes zero rows and is reported distinctly below. A stale
    // reservation qualifies too (the operator reconciled it on-chain, found
    // the transfer landed, and refunded it); a FRESH reservation never does,
    // because its settle is still in flight.
    // Placeholders are numbered throughout: mixing bare "?" with "?N" makes
    // SQLite continue numbering from the highest explicit index, which
    // silently collides bindings.
    const statusPlaceholders = REFUNDABLE_STATUSES.map(
      (_unusedStatus, statusIndex) => `?${4 + statusIndex}`,
    ).join(", ");
    let updateResult: { changes: number };
    try {
      updateResult = database
        .query(
          `UPDATE settlements
             SET status = 'refunded', refund_tx_signature = ?2, updated_at = unixepoch()
           WHERE payment_key = ?1
             AND (status IN (${statusPlaceholders})
                  OR (status = 'reserved' AND created_at < unixepoch() - ?3))`,
        )
        .run(paymentKey, refundTxSignature, STALE_RESERVATION_SECONDS, ...REFUNDABLE_STATUSES);
    } catch (uniqueConstraintError) {
      // The partial unique index on refund_tx_signature caught a refund tx
      // already recorded for another payment (audit A4).
      const message =
        uniqueConstraintError instanceof Error
          ? uniqueConstraintError.message
          : String(uniqueConstraintError);
      return err({
        code: "duplicate_refund_tx",
        message: `this refund tx signature is already recorded for another payment: ${message}`,
      });
    }
    if (updateResult.changes === 1) {
      return ok(undefined);
    }
    const existingRow = database
      .query(`SELECT status FROM settlements WHERE payment_key = ?1`)
      .get(paymentKey) as { status: SettlementStatus } | null;
    if (!existingRow) {
      return err({
        code: "not_found",
        message: "no payment found for this payment key",
      });
    }
    return err({
      code: "not_refundable",
      message: `payment is not awaiting a refund (status: ${existingRow.status})`,
    });
  };

  const listPaidWithoutDeployment: SettlementStore["listPaidWithoutDeployment"] = () => {
    // Every state where money may have moved but no running deployment resulted:
    // settled (stuck between settle and provision), provision_failed, and
    // settle_unknown (settle outcome unresolved). settle_rejected moved no money
    // and refunded has been paid back; both are excluded.
    const rows = database
      .query(
        `SELECT payment_key, status, tx_signature, payer, market_slug,
                duration_minutes, amount_atomic, deployment_id, refund_tx_signature
           FROM settlements
          WHERE status IN (${REFUNDABLE_STATUSES.map(() => "?").join(", ")})`,
      )
      .all(...REFUNDABLE_STATUSES) as SettlementRow[];
    return rows.map(mapRowToRecord);
  };

  const listStaleReservations: SettlementStore["listStaleReservations"] = () => {
    const rows = database
      .query(
        `SELECT payment_key, status, tx_signature, payer, market_slug,
                duration_minutes, amount_atomic, deployment_id, refund_tx_signature
           FROM settlements
          WHERE status = 'reserved'
            AND created_at < unixepoch() - ?1`,
      )
      .all(STALE_RESERVATION_SECONDS) as SettlementRow[];
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
      refundedCount: countForStatus("refunded"),
      refundedAtomicTotal: totalForStatus("refunded"),
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
    markRefunded,
    listPaidWithoutDeployment,
    listStaleReservations,
    summarizeLedger,
  };
};
