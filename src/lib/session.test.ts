import { describe, expect, test } from "bun:test";
import { sign } from "hono/jwt";
import { createRentSession, verifyRentSession } from "./session.js";

// Test-only secret, 64 hex chars like a real openssl rand -hex 32 output.
const TEST_JWT_SECRET = "a".repeat(64);
const DEPLOYMENT_ID = "deployment-under-test";

const createValidSession = () =>
  createRentSession({
    deploymentId: DEPLOYMENT_ID,
    payer: "payer-pubkey",
    txSignature: "tx-signature",
    durationMinutes: 10,
    jwtSecret: TEST_JWT_SECRET,
  });

describe("verifyRentSession", () => {
  test("accepts its own signed session and returns the claims", async () => {
    const session = await createValidSession();
    const verification = await verifyRentSession({
      authorizationHeader: `Bearer ${session}`,
      expectedDeploymentId: DEPLOYMENT_ID,
      jwtSecret: TEST_JWT_SECRET,
    });
    expect(verification.ok).toBe(true);
    if (verification.ok) {
      expect(verification.value.deployment_id).toBe(DEPLOYMENT_ID);
      expect(verification.value.tx_signature).toBe("tx-signature");
      expect(verification.value.payer).toBe("payer-pubkey");
    }
  });

  test("rejects a missing Authorization header", async () => {
    const verification = await verifyRentSession({
      authorizationHeader: undefined,
      expectedDeploymentId: DEPLOYMENT_ID,
      jwtSecret: TEST_JWT_SECRET,
    });
    expect(verification.ok).toBe(false);
    if (!verification.ok) {
      expect(verification.reason).toContain("missing session");
    }
  });

  test("rejects a non-Bearer header", async () => {
    const verification = await verifyRentSession({
      authorizationHeader: "Basic dXNlcjpwYXNz",
      expectedDeploymentId: DEPLOYMENT_ID,
      jwtSecret: TEST_JWT_SECRET,
    });
    expect(verification.ok).toBe(false);
  });

  test("rejects a token signed with another secret", async () => {
    const session = await createValidSession();
    const verification = await verifyRentSession({
      authorizationHeader: `Bearer ${session}`,
      expectedDeploymentId: DEPLOYMENT_ID,
      jwtSecret: "b".repeat(64),
    });
    expect(verification.ok).toBe(false);
    if (!verification.ok) {
      expect(verification.reason).toBe("session invalid or expired");
    }
  });

  test("rejects an expired token", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiredToken = await sign(
      {
        deployment_id: DEPLOYMENT_ID,
        tx_signature: "tx-signature",
        payer: null,
        iat: nowSeconds - 100,
        exp: nowSeconds - 10,
      },
      TEST_JWT_SECRET,
      "HS256",
    );
    const verification = await verifyRentSession({
      authorizationHeader: `Bearer ${expiredToken}`,
      expectedDeploymentId: DEPLOYMENT_ID,
      jwtSecret: TEST_JWT_SECRET,
    });
    expect(verification.ok).toBe(false);
    if (!verification.ok) {
      expect(verification.reason).toBe("session invalid or expired");
    }
  });

  test("rejects a session presented against another deployment", async () => {
    const session = await createValidSession();
    const verification = await verifyRentSession({
      authorizationHeader: `Bearer ${session}`,
      expectedDeploymentId: "another-deployment",
      jwtSecret: TEST_JWT_SECRET,
    });
    expect(verification.ok).toBe(false);
    if (!verification.ok) {
      expect(verification.reason).toBe("session does not grant access to this deployment");
    }
  });

  test("rejects a valid signature whose payload misses required claims", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const malformedToken = await sign(
      { iat: nowSeconds, exp: nowSeconds + 600 },
      TEST_JWT_SECRET,
      "HS256",
    );
    const verification = await verifyRentSession({
      authorizationHeader: `Bearer ${malformedToken}`,
      expectedDeploymentId: DEPLOYMENT_ID,
      jwtSecret: TEST_JWT_SECRET,
    });
    expect(verification.ok).toBe(false);
    if (!verification.ok) {
      expect(verification.reason).toBe("session payload is malformed");
    }
  });
});
