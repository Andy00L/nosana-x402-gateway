import type { PaymentRequirements } from "x402-solana/server";
import { type Result, ok, err } from "./result.js";
import {
  verifyPaymentSafely,
  settlePaymentSafely,
  type PaymentFacilitatorClient,
} from "./x402.js";
import { hashPaymentHeader, type SettlementStore } from "./settlementStore.js";
import type { ProvisioningService } from "./provisioning.js";
import type { RentQuote } from "./pricing.js";

// One payment gauntlet shared by every paid route (/rent and /rent/:id/extend)
// so the safety order lives in exactly one place: refuse-if-unfulfillable,
// verify, reserve (anti-replay), capacity, settle BEFORE fulfillment, record.
// The caller performs its own fulfillment and marks the outcome on the store
// (docs/x402-execution-plan.md section 4 step B).

// A Solana transaction signature is 64 bytes base58-encoded (about 86 to 88
// chars). Reject empty or malformed values the facilitator might return so a
// bogus signature never becomes our authoritative anti-replay key, and so a
// success:true with no real transfer never provisions compute (audit H1).
const SOLANA_SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const isPlausibleSignature = (value: string): boolean =>
  SOLANA_SIGNATURE_PATTERN.test(value);

export interface PaymentFailure {
  readonly status: 402 | 409 | 502 | 503;
  readonly message: string;
}

export interface CompletedPayment {
  readonly paymentKey: string;
  readonly txSignature: string;
  readonly payer: string | null;
}

export interface PaymentFlowDependencies {
  readonly x402Handler: PaymentFacilitatorClient;
  readonly settlementStore: SettlementStore;
  readonly provisioningService: Pick<
    ProvisioningService,
    "isConfigured" | "checkCreditsCoverQuote"
  >;
}

export const collectPayment = async (
  dependencies: PaymentFlowDependencies,
  paymentHeader: string,
  requirements: PaymentRequirements,
  quote: RentQuote,
): Promise<Result<CompletedPayment, PaymentFailure>> => {
  const { x402Handler, settlementStore, provisioningService } = dependencies;

  if (!provisioningService.isConfigured) {
    return err({
      status: 503,
      message:
        "gateway is not configured for fulfillment (no Nosana API key): payment refused before any money moved",
    });
  }

  const verifyResult = await verifyPaymentSafely(x402Handler, paymentHeader, requirements);
  if (!verifyResult.ok) {
    return err({ status: 502, message: verifyResult.reason });
  }
  if (!verifyResult.value.isValid) {
    return err({
      status: 402,
      message: `payment verification failed: ${verifyResult.value.invalidReason ?? "invalid payment"}`,
    });
  }

  const paymentKey = hashPaymentHeader(paymentHeader);
  const reservation = settlementStore.reservePayment(paymentKey, {
    marketSlug: quote.market.slug,
    durationMinutes: quote.durationMinutes,
    amountAtomic: quote.amountAtomic,
  });
  if (!reservation.ok) {
    return err({ status: 409, message: reservation.reason });
  }

  const capacityCheck = await provisioningService.checkCreditsCoverQuote(quote);
  if (!capacityCheck.ok) {
    settlementStore.releaseReservation(paymentKey);
    return err({ status: 503, message: capacityCheck.reason });
  }

  const settleResult = await settlePaymentSafely(x402Handler, paymentHeader, requirements);
  if (!settleResult.ok) {
    // Settle transport error: the on-chain transfer MAY have landed even though
    // the call did not return. Do NOT release the reservation, that would let
    // the same header provision twice (audit C1). Flag as unknown so the key
    // stays blocked and the payment is surfaced for reconciliation.
    settlementStore.markSettleUnknown(paymentKey);
    console.error(
      `[collectPayment] settle outcome unknown, flagged for reconciliation: ${settleResult.reason}`,
    );
    return err({ status: 502, message: settleResult.reason });
  }
  if (!settleResult.value.success) {
    // Facilitator explicitly refused: no money moved. Keep the key (blocks
    // replay of this exact header) but record it as rejected, not owed.
    settlementStore.markSettleRejected(paymentKey);
    return err({
      status: 402,
      message: `payment settlement failed: ${settleResult.value.errorReason ?? "settlement rejected"}`,
    });
  }

  const txSignature = settleResult.value.transaction;
  if (!isPlausibleSignature(txSignature)) {
    // Settle reported success but returned no usable signature. Money may have
    // moved; we will not trust a bogus value as our anti-replay key nor
    // provision on it. Flag for reconciliation (audit H1).
    settlementStore.markSettleUnknown(paymentKey);
    console.error(
      "[collectPayment] settle reported success with an implausible signature, flagged for reconciliation",
    );
    return err({
      status: 502,
      message: "settlement returned no usable transaction signature: flagged for reconciliation",
    });
  }

  const payer = verifyResult.value.payer ?? settleResult.value.payer ?? null;
  const settledRecord = settlementStore.markSettled(paymentKey, txSignature, payer);
  if (!settledRecord.ok) {
    // Money settled but this signature is already recorded under another key
    // (facilitator idempotency or a duplicate header). Do NOT leave the row
    // 'reserved', that hides settled money from reconciliation (audit H2):
    // flag it as unknown/owed.
    settlementStore.markSettleUnknown(paymentKey);
    console.error(`[collectPayment] ${settledRecord.reason} tx=${txSignature}`);
    return err({ status: 409, message: settledRecord.reason });
  }

  return ok({ paymentKey, txSignature, payer });
};
