import { describe, expect, test } from "bun:test";
import { loadGatewayConfig } from "./config.js";

// A syntactically valid base58 pubkey (the devnet USDC mint).
const VALID_PUBKEY = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const VALID_JWT_SECRET = "c".repeat(64);

const buildValidEnvironment = (): Record<string, string | undefined> => ({
  NOSANA_X402_NETWORK: "devnet",
  TREASURY_WALLET_ADDRESS: VALID_PUBKEY,
  JWT_SECRET: VALID_JWT_SECRET,
});

describe("loadGatewayConfig", () => {
  test("accepts a valid environment and applies defaults", () => {
    const config = loadGatewayConfig(buildValidEnvironment());
    expect(config.ok).toBe(true);
    if (config.ok) {
      expect(config.value.x402Network).toBe("solana-devnet");
      expect(config.value.port).toBe(3000);
      expect(config.value.facilitatorUrl).toBe("https://facilitator.payai.network");
      expect(config.value.settlementDbPath).toBe("data/gateway.db");
      expect(config.value.nosanaApiKey).toBeUndefined();
      expect(config.value.adminToken).toBeUndefined();
      expect(config.value.minCreditsFloorCents).toBe(0);
    }
  });

  test("maps mainnet to the simple x402 network name", () => {
    const environment = { ...buildValidEnvironment(), NOSANA_X402_NETWORK: "mainnet" };
    const config = loadGatewayConfig(environment);
    expect(config.ok).toBe(true);
    if (config.ok) {
      expect(config.value.x402Network).toBe("solana");
    }
  });

  test("rejects an unknown network", () => {
    const environment = { ...buildValidEnvironment(), NOSANA_X402_NETWORK: "testnet" };
    expect(loadGatewayConfig(environment).ok).toBe(false);
  });

  test("rejects a missing treasury address", () => {
    const environment = buildValidEnvironment();
    delete environment.TREASURY_WALLET_ADDRESS;
    const config = loadGatewayConfig(environment);
    expect(config.ok).toBe(false);
    if (!config.ok) {
      expect(config.reason).toContain("TREASURY_WALLET_ADDRESS");
    }
  });

  test("rejects a treasury address that is not base58", () => {
    const environment = {
      ...buildValidEnvironment(),
      TREASURY_WALLET_ADDRESS: "0xdeadbeef00000000000000000000000000000000",
    };
    expect(loadGatewayConfig(environment).ok).toBe(false);
  });

  test("rejects a missing or short JWT secret", () => {
    const withoutSecret = buildValidEnvironment();
    delete withoutSecret.JWT_SECRET;
    expect(loadGatewayConfig(withoutSecret).ok).toBe(false);

    const withShortSecret = { ...buildValidEnvironment(), JWT_SECRET: "too-short" };
    expect(loadGatewayConfig(withShortSecret).ok).toBe(false);
  });

  test("rejects an out-of-range port", () => {
    const environment = { ...buildValidEnvironment(), PORT: "70000" };
    expect(loadGatewayConfig(environment).ok).toBe(false);
  });

  test("treats an empty API key as absent", () => {
    const environment = { ...buildValidEnvironment(), NOSANA_API_KEY: "" };
    const config = loadGatewayConfig(environment);
    expect(config.ok).toBe(true);
    if (config.ok) {
      expect(config.value.nosanaApiKey).toBeUndefined();
    }
  });

  test("reads the admin token and the credits floor when set", () => {
    const environment = {
      ...buildValidEnvironment(),
      ADMIN_TOKEN: "s3cr3t-admin-token",
      MIN_CREDITS_FLOOR_CENTS: "50",
    };
    const config = loadGatewayConfig(environment);
    expect(config.ok).toBe(true);
    if (config.ok) {
      expect(config.value.adminToken).toBe("s3cr3t-admin-token");
      expect(config.value.minCreditsFloorCents).toBe(50);
    }
  });

  test("rejects a negative or non-integer credits floor", () => {
    const negativeFloor = { ...buildValidEnvironment(), MIN_CREDITS_FLOOR_CENTS: "-10" };
    expect(loadGatewayConfig(negativeFloor).ok).toBe(false);

    const fractionalFloor = { ...buildValidEnvironment(), MIN_CREDITS_FLOOR_CENTS: "1.5" };
    expect(loadGatewayConfig(fractionalFloor).ok).toBe(false);
  });
});
