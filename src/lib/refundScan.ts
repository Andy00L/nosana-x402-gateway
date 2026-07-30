import type { SettlementRecord, SettlementStore } from "./settlementStore.js";

// Scans the ledger for money received without a delivered deployment and
// prints each refund owed. index.ts calls this at startup (crash recovery
// between settle and provision) and on a timer, so a provision failure that
// happens while the gateway is up surfaces within minutes instead of waiting
// for the next restart. Returns the records it reported so tests can assert
// on them without capturing console output.
export const reportRefundsOwed = (
  settlementStore: Pick<SettlementStore, "listPaidWithoutDeployment">,
): SettlementRecord[] => {
  const refundsOwed = settlementStore.listPaidWithoutDeployment();
  if (refundsOwed.length === 0) {
    return refundsOwed;
  }
  console.error(
    `[reportRefundsOwed] REFUNDS OWED: ${refundsOwed.length} settled payment(s) without a running deployment`,
  );
  for (const record of refundsOwed) {
    console.error(
      `[reportRefundsOwed] refund owed: tx=${record.txSignature} payer=${record.payer} amountAtomic=${record.amountAtomic} market=${record.marketSlug}`,
    );
  }
  return refundsOwed;
};
