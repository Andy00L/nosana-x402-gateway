import { NosanaNetwork } from "@nosana/kit";
import { type Result, ok, err } from "./lib/result.js";

// Quote validity window in seconds. Bounds how long a signed payment stays
// acceptable; the payer's transaction blockhash (about 150 slots) is the hard
// on-chain limit. Default mirrors x402-solana RouteConfig.maxTimeoutSeconds.
export const QUOTE_TIMEOUT_SECONDS = 300;

// Rental duration bounds in minutes. Nosana's DeploymentCreateBody requires at
// least 1 minute (sourceRef: @nosana/api dist/client/deployment-manager/schema.d.ts).
// The 24h ceiling is gateway policy for v1, not a Nosana limit.
export const MIN_RENT_DURATION_MINUTES = 1;
export const MAX_RENT_DURATION_MINUTES = 1440;

// Base58 pubkey shape (Solana addresses are 32 to 44 base58 chars).
const BASE58_PUBKEY_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Default facilitator: PayAI, gasless, no API key needed on devnet
// (sourceRef: docs/x402-execution-plan.md section 3).
const DEFAULT_FACILITATOR_URL = "https://facilitator.payai.network";

const DEFAULT_PORT = 3000;

// Minimum JWT secret length in characters; 32 bytes hex is 64 chars, anything
// shorter than 32 chars is too weak to sign sessions with.
const MIN_JWT_SECRET_LENGTH = 32;

const DEFAULT_SETTLEMENT_DB_PATH = "data/gateway.db";

export interface GatewayConfig {
  // Simple x402 network format expected by X402ServerConfig
  // (sourceRef: x402-solana dist X402ServerConfig.network).
  readonly x402Network: "solana" | "solana-devnet";
  readonly nosanaNetwork: NosanaNetwork;
  readonly treasuryAddress: string;
  readonly facilitatorUrl: string;
  readonly nosanaApiKey: string | undefined;
  readonly jwtSecret: string;
  readonly settlementDbPath: string;
  readonly port: number;
}

export const loadGatewayConfig = (
  environment: Record<string, string | undefined>,
): Result<GatewayConfig> => {
  const networkName = environment.NOSANA_X402_NETWORK ?? "devnet";
  if (networkName !== "devnet" && networkName !== "mainnet") {
    return err(
      `NOSANA_X402_NETWORK must be "devnet" or "mainnet", got "${networkName}"`,
    );
  }

  const treasuryAddress = environment.TREASURY_WALLET_ADDRESS;
  if (!treasuryAddress) {
    return err(
      "TREASURY_WALLET_ADDRESS is required: the base58 pubkey that receives USDC payments",
    );
  }
  if (!BASE58_PUBKEY_PATTERN.test(treasuryAddress)) {
    return err(
      "TREASURY_WALLET_ADDRESS is not a valid base58 Solana pubkey (32 to 44 base58 chars)",
    );
  }

  const jwtSecret = environment.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    return err(
      `JWT_SECRET is required and must be at least ${MIN_JWT_SECRET_LENGTH} characters (generate one with: openssl rand -hex 32)`,
    );
  }

  const portRaw = environment.PORT;
  const port = portRaw === undefined ? DEFAULT_PORT : Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return err(`PORT must be an integer between 1 and 65535, got "${portRaw}"`);
  }

  return ok({
    x402Network: networkName === "devnet" ? "solana-devnet" : "solana",
    nosanaNetwork:
      networkName === "devnet" ? NosanaNetwork.DEVNET : NosanaNetwork.MAINNET,
    treasuryAddress,
    facilitatorUrl: environment.FACILITATOR_URL ?? DEFAULT_FACILITATOR_URL,
    nosanaApiKey: environment.NOSANA_API_KEY || undefined,
    jwtSecret,
    settlementDbPath: environment.SETTLEMENT_DB_PATH ?? DEFAULT_SETTLEMENT_DB_PATH,
    port,
  });
};
