import { describe, expect, test } from "bun:test";
import {
  PAYMENT_SIGNATURE_HEADER,
  buildPaymentChallengeHint,
  buildRentNextSteps,
  buildServiceDescription,
} from "./agentGuide.js";
import { PAYMENT_REQUIRED_HEADER } from "./x402.js";

describe("buildPaymentChallengeHint", () => {
  test("names the exact header the paid retry must carry", () => {
    const hint = buildPaymentChallengeHint();
    expect(hint.payment_header).toBe(PAYMENT_SIGNATURE_HEADER);
    expect(PAYMENT_SIGNATURE_HEADER).toBe("PAYMENT-SIGNATURE");
  });

  test("tells the agent no money has moved yet", () => {
    const hint = buildPaymentChallengeHint();
    expect(hint.protocol).toBe("x402");
    expect(hint.x402_version).toBe(2);
    expect(hint.what.toLowerCase()).toContain("no money has moved");
  });

  test("points at the accepts fields an agent pays from", () => {
    const hint = buildPaymentChallengeHint();
    expect(hint.how).toContain("accepts[0].amount");
    expect(hint.how).toContain("accepts[0].payTo");
    expect(hint.amount_units).toContain("atomic units");
  });
});

describe("buildRentNextSteps", () => {
  test("embeds the deployment id in every lifecycle call", () => {
    const next = buildRentNextSteps("9H4bVD1v");
    expect(next.status).toContain("GET /rent/9H4bVD1v");
    expect(next.extend).toContain("POST /rent/9H4bVD1v/extend");
    expect(next.stop).toContain("POST /rent/9H4bVD1v/stop");
  });

  test("explains both result paths: the endpoints URL and results by job id", () => {
    const next = buildRentNextSteps("job-address");
    expect(next.results).toContain("endpoints[]");
    expect(next.results.toLowerCase()).toContain("by job id");
  });
});

describe("buildServiceDescription", () => {
  test("advertises both x402 headers by their real names", () => {
    const description = buildServiceDescription("solana");
    expect(description.protocol.payment_header).toBe(PAYMENT_SIGNATURE_HEADER);
    expect(description.protocol.challenge_header).toBe(PAYMENT_REQUIRED_HEADER);
    expect(description.protocol.version).toBe(2);
  });

  test("names the network it settles on", () => {
    expect(buildServiceDescription("solana").what).toContain("solana");
    expect(buildServiceDescription("solana-devnet").what).toContain("solana-devnet");
  });

  test("lists the flow in order and every routed endpoint", () => {
    const description = buildServiceDescription("solana");
    expect(description.flow[0]).toContain("GET /markets");
    expect(description.flow.length).toBe(5);
    for (const route of [
      "GET /health",
      "GET /markets",
      "POST /rent",
      "GET /rent/:id",
      "POST /rent/:id/extend",
      "POST /rent/:id/stop",
    ]) {
      expect(description.endpoints[route]).toBeDefined();
    }
  });
});
