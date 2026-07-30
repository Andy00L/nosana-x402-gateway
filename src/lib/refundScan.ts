import type { SettlementRecord, SettlementStore } from "./settlementStore.js";

export interface RefundScanReport {
  // Money received (or possibly received) with no delivered deployment.
  readonly refundsOwed: SettlementRecord[];
  // Reservations old enough that the process must have died mid-settle:
  // money MAY have moved without the row ever recording it (audit A3).
  readonly staleReservations: SettlementRecord[];
}

// Scans the ledger for money received without a delivered deployment and
// prints each refund owed, plus any stale reservation whose settle outcome
// was lost to a crash. index.ts calls this at startup (crash recovery
// between settle and provision) and on a timer, so a provision failure that
// happens while the gateway is up surfaces within minutes instead of waiting
// for the next restart. Returns what it reported so tests can assert on it
// without capturing console output.
export const reportRefundsOwed = (
  settlementStore: Pick<SettlementStore, "listPaidWithoutDeployment" | "listStaleReservations">,
): RefundScanReport => {
  const refundsOwed = settlementStore.listPaidWithoutDeployment();
  if (refundsOwed.length > 0) {
    console.error(
      `[reportRefundsOwed] REFUNDS OWED: ${refundsOwed.length} settled payment(s) without a running deployment`,
    );
    for (const record of refundsOwed) {
      console.error(
        `[reportRefundsOwed] refund owed: tx=${record.txSignature} payer=${record.payer} amountAtomic=${record.amountAtomic} market=${record.marketSlug}`,
      );
    }
  }
  const staleReservations = settlementStore.listStaleReservations();
  if (staleReservations.length > 0) {
    console.error(
      `[reportRefundsOwed] STALE RESERVATIONS: ${staleReservations.length} reservation(s) stuck mid-settle; reconcile on-chain whether the transfer landed`,
    );
    for (const record of staleReservations) {
      console.error(
        `[reportRefundsOwed] stale reservation: paymentKey=${record.paymentKey} amountAtomic=${record.amountAtomic} market=${record.marketSlug}`,
      );
    }
  }
  return { refundsOwed, staleReservations };
};
