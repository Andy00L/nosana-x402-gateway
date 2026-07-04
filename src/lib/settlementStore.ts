import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Result, ok, err } from "./result.js";

// Payment lifecycle: reserved -> settled -> provisioned | provision_failed.
// A reservation is deleted when settle fails, so the payer can retry the same
// signed transaction after a transient facilitator failure. Persistent by
// design: a crash between settle and provision must survive a restart
// (docs/x402-execution-plan.md section 6).
export type SettlementStatus = "reserved" | "settled" | "provisioned" | "provision_failed";

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
  markProvisioned: (paymentKey: string, deploymentId: string) => void;
  markProvisionFailed: (paymentKey: string, deploymentId: string | null) => void;
  listPaidWithoutDeployment: () => SettlementRecord[];
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
    const rows = database
      .query(
        `SELECT payment_key, status, tx_signature, payer, market_slug,
                duration_minutes, amount_atomic, deployment_id
           FROM settlements
          WHERE status IN ('settled', 'provision_failed')`,
      )
      .all() as SettlementRow[];
    return rows.map(mapRowToRecord);
  };

  return {
    reservePayment,
    releaseReservation,
    markSettled,
    markProvisioned,
    markProvisionFailed,
    listPaidWithoutDeployment,
  };
};
