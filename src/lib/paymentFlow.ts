import type { PaymentRequirements, X402PaymentHandler } from "x402-solana/server";
import { type Result, ok, err } from "./result.js";
import { verifyPaymentSafely, settlePaymentSafely } from "./x402.js";
import { hashPaymentHeader, type SettlementStore } from "./settlementStore.js";
import type { ProvisioningService } from "./provisioning.js";
import type { RentQuote } from "./pricing.js";

// One payment gauntlet shared by every paid route (/rent and /rent/:id/extend)
// so the safety order lives in exactly one place: refuse-if-unfulfillable,
// verify, reserve (anti-replay), capacity, settle BEFORE fulfillment, record.
// The caller performs its own fulfillment and marks the outcome on the store
// (docs/x402-execution-plan.md section 4 step B).

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
  readonly x402Handler: X402PaymentHandler;
  readonly settlementStore: SettlementStore;
  readonly provisioningService: ProvisioningService;
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
    settlementStore.releaseReservation(paymentKey);
    return err({ status: 502, message: settleResult.reason });
  }
  if (!settleResult.value.success) {
    settlementStore.releaseReservation(paymentKey);
    return err({
      status: 402,
      message: `payment settlement failed: ${settleResult.value.errorReason ?? "settlement rejected"}`,
    });
  }

  const txSignature = settleResult.value.transaction;
  const payer = verifyResult.value.payer ?? settleResult.value.payer ?? null;
  const settledRecord = settlementStore.markSettled(paymentKey, txSignature, payer);
  if (!settledRecord.ok) {
    // Money settled but the transaction signature was already recorded under
    // another payment key: replay caught at the last gate, do not fulfill.
    console.error(`[collectPayment] ${settledRecord.reason} tx=${txSignature}`);
    return err({ status: 409, message: settledRecord.reason });
  }

  return ok({ paymentKey, txSignature, payer });
};
