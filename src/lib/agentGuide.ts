import { PAYMENT_REQUIRED_HEADER } from "./x402.js";

// Machine-readable, plain-language guidance that makes the x402 rent flow
// self-describing to an agent that has never seen this gateway. These builders
// are the single source of truth for that guidance, surfaced in the three places
// an agent looks: GET / serves the whole map, every 402 carries the challenge
// hint, and a rent receipt carries the next steps. Pure functions, so the exact
// wording is unit-tested without a running server, and the flow is described in
// one place instead of drifting across routes.

// The header the x402 client puts its signed payment in on the retry (x402 v2).
// sourceRef: x402-solana extractPayment reads "PAYMENT-SIGNATURE"; the sibling
// PAYMENT-REQUIRED header (src/lib/x402.ts) is what keeps the client on v2.
export const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";

// Public repository, for an agent (or its developer) that wants the full docs.
// sourceRef: README clone URL.
const GATEWAY_REPO_URL = "https://github.com/Andy00L/nosana-x402-gateway";

export interface PaymentChallengeHint {
  readonly protocol: "x402";
  readonly x402_version: 2;
  readonly what: string;
  readonly how: string;
  readonly payment_header: string;
  readonly amount_units: string;
}

// Added to every 402 so an agent that does not already speak x402 learns, from
// the response body itself, that it has not been charged and what the paid retry
// looks like. A sibling of `accepts`; the x402 client strips unknown keys, so it
// is non-breaking for clients that only read the protocol fields.
export const buildPaymentChallengeHint = (): PaymentChallengeHint => ({
  protocol: "x402",
  x402_version: 2,
  what: "Payment is required to continue. This is an x402 challenge, not a charge: no money has moved yet.",
  how: "Sign a USDC transfer of accepts[0].amount to accepts[0].payTo on accepts[0].network, then send this exact request again with the signed x402 payment in the PAYMENT-SIGNATURE header. An x402 client library performs these steps for you.",
  payment_header: PAYMENT_SIGNATURE_HEADER,
  amount_units: "accepts[0].amount is USDC in atomic units (6 decimals): 1000000 = 1 USDC.",
});

export interface RentNextSteps {
  readonly status: string;
  readonly extend: string;
  readonly stop: string;
  readonly results: string;
}

// Added to a successful rent receipt so the agent knows how to drive the rental
// it just paid for. The results line names the two ways output comes back on
// the credits rail: a live URL per exposed port (in endpoints[]), and batch
// results by job id.
export const buildRentNextSteps = (deploymentId: string): RentNextSteps => ({
  status: `GET /rent/${deploymentId} with header "Authorization: Bearer <session>" to poll status and timeout_minutes.`,
  extend: `POST /rent/${deploymentId}/extend {"duration_minutes": N} to add time (another x402 payment).`,
  stop: `POST /rent/${deploymentId}/stop with the session to end the rental.`,
  results:
    "If the job definition exposes a port, endpoints[] carries its live service URL (answers once status is RUNNING). Batch results come back by job id (this deployment_id).",
});

export interface ServiceDescription {
  readonly service: string;
  readonly what: string;
  readonly protocol: {
    readonly name: "x402";
    readonly version: 2;
    readonly challenge_header: string;
    readonly payment_header: string;
  };
  readonly flow: readonly string[];
  readonly endpoints: Readonly<Record<string, string>>;
  readonly docs: string;
}

// Served at GET / as the whole flow on one page: what the gateway is, the two
// x402 headers, the ordered steps, and every endpoint with its auth. This is the
// single artifact an agent can read to orient before it makes any request.
export const buildServiceDescription = (
  network: "solana" | "solana-devnet",
): ServiceDescription => ({
  service: "nosana-x402-gateway",
  what: `Rent Nosana GPU compute by paying USDC over HTTP with the x402 protocol on ${network}. No Nosana account, no NOS token, and no Solana SDK are needed on the agent side.`,
  protocol: {
    name: "x402",
    version: 2,
    challenge_header: PAYMENT_REQUIRED_HEADER,
    payment_header: PAYMENT_SIGNATURE_HEADER,
  },
  flow: [
    "1. GET /markets lists GPU tiers with their live USD/hour rate and current queue availability.",
    "2. POST /rent {market, duration_minutes, job_definition} answers 402 with x402 PaymentRequirements (amount, payTo) plus an availability block.",
    "3. Sign a USDC transfer for that amount and POST /rent again with the PAYMENT-SIGNATURE header: the gateway verifies, settles on Solana, provisions the job, and returns 200 with deployment_id, a session JWT, and the settlement tx.",
    "4. GET /rent/:id with the session polls status and timeout_minutes.",
    "5. POST /rent/:id/extend adds time (another payment); POST /rent/:id/stop ends the rental.",
  ],
  endpoints: {
    "GET /health": "liveness check, no auth.",
    "GET /markets": "GPU tiers with live rate and availability, no auth.",
    "POST /rent": "x402-paid: rent a GPU (answers 402 until paid).",
    "GET /rent/:id": "session-auth: deployment status and timeout.",
    "POST /rent/:id/extend": "x402-paid and session-auth: add minutes.",
    "POST /rent/:id/stop": "session-auth: stop the rental.",
  },
  docs: GATEWAY_REPO_URL,
});
