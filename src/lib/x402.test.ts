import { describe, expect, test } from "bun:test";
import { encodePaymentRequiredHeader, PAYMENT_REQUIRED_HEADER } from "./x402.js";

// Mirror x402-solana's client decode (safeBase64Decode via atob, then
// JSON.parse) so these tests prove the header we emit is exactly what the client
// consumes. sourceRef: x402-solana dist/client/index.js decodePaymentRequiredHeader.
const decodeLikeClient = (header: string): unknown => {
  const binaryString = atob(header);
  const bytes = Uint8Array.from(binaryString, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
};

describe("encodePaymentRequiredHeader", () => {
  test("the header name is the one the x402 client looks for", () => {
    expect(PAYMENT_REQUIRED_HEADER).toBe("PAYMENT-REQUIRED");
  });

  test("round-trips a payment-required body through the client's decode", () => {
    const paymentRequiredBody = {
      x402Version: 2,
      resource: { url: "http://localhost/rent", description: "GPU", mimeType: "application/json" },
      accepts: [
        {
          scheme: "exact",
          network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
          amount: "727",
          payTo: "7BF8eaGq9hgJGQcauqZyDwkfF9ZViHomwvnLnjw7ABLw",
          asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        },
      ],
      error: "Payment required",
    };
    const header = encodePaymentRequiredHeader(paymentRequiredBody);
    // Standard base64 (the alphabet @payai/x402 safeBase64Decode accepts).
    expect(header).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
    expect(decodeLikeClient(header)).toEqual(paymentRequiredBody);
  });

  test("preserves the accepts array the client selects a requirement from", () => {
    const body = {
      x402Version: 2,
      accepts: [{ scheme: "exact", network: "solana" }],
      error: "Payment required",
    };
    const decoded = decodeLikeClient(encodePaymentRequiredHeader(body)) as {
      accepts: unknown[];
    };
    expect(decoded.accepts).toHaveLength(1);
  });

  test("handles multi-byte UTF-8 in the body without corruption", () => {
    const body = { note: "café", accepts: [] };
    const decoded = decodeLikeClient(encodePaymentRequiredHeader(body)) as { note: string };
    expect(decoded.note).toBe("café");
  });
});
