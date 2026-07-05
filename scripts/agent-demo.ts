// Mock x402 agent for the Phase 1 sign-off: rents a GPU through the gateway
// exactly the way a real agent would, with no knowledge of Nosana internals.
// Steps: discover markets, rent (pay the 402), poll until running, hit the
// deployment endpoint, extend (pay again), stop. Each step reports
// PASS, BLOCKED, or FAIL with a distinct reason, and the run degrades
// honestly when funding or gateway configuration is missing.
//
// Environment (all optional):
//   GATEWAY_URL             gateway base URL (default http://localhost:3000)
//   AGENT_WALLET_SECRET     base58 secret key of the paying wallet; when
//                           absent an ephemeral wallet is generated and the
//                           run stops at payment with faucet instructions
//   AGENT_X402_NETWORK      "solana-devnet" (default) or "solana"
//   AGENT_MARKET            market slug; default: cheapest listed market
//   AGENT_DURATION_MINUTES  rental and extension length (default 2)
import { Keypair, type VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { createX402Client } from "x402-solana/client";

// Devnet USDC faucet for funding the agent wallet (Circle's official faucet).
const DEVNET_USDC_FAUCET_URL = "https://faucet.circle.com";
// Poll cadence and ceiling for waiting on a deployment to reach RUNNING.
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 300_000;

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:3000";
const AGENT_DURATION_MINUTES = Number.parseInt(
  process.env.AGENT_DURATION_MINUTES ?? "2",
  10,
);

// The sign-off job serves an HTTP port so the "poll the endpoint" step is
// testable: nginx on port 80, exposed through Nosana
// (docs/x402-execution-plan.md section 9).
const SIGN_OFF_JOB_DEFINITION = {
  version: "0.1",
  type: "container",
  ops: [
    {
      type: "container/run",
      id: "web",
      args: { image: "nginx", expose: 80 },
    },
  ],
};

interface StepResult {
  readonly name: string;
  readonly outcome: "PASS" | "BLOCKED" | "FAIL";
  readonly detail: string;
}

const stepResults: StepResult[] = [];

const recordStep = (name: string, outcome: StepResult["outcome"], detail: string) => {
  stepResults.push({ name, outcome, detail });
  console.log(`[agentDemo] ${outcome} ${name}: ${detail}`);
};

const printSummaryAndExit = (): never => {
  console.log("\n[agentDemo] ===== sign-off summary =====");
  for (const step of stepResults) {
    console.log(`[agentDemo] ${step.outcome.padEnd(7)} ${step.name}`);
  }
  const hasFailure = stepResults.some((step) => step.outcome === "FAIL");
  const hasBlocked = stepResults.some((step) => step.outcome === "BLOCKED");
  process.exit(hasFailure ? 1 : hasBlocked ? 2 : 0);
};

const waitMilliseconds = (durationMs: number) =>
  new Promise((resolveWait) => setTimeout(resolveWait, durationMs));

const readJsonBody = async (response: Response): Promise<Record<string, unknown>> => {
  const bodyText = await response.text();
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through: non-JSON body summarized below
  }
  return { raw: bodyText.slice(0, 200) };
};

const loadAgentWallet = (): { keypair: Keypair; isEphemeral: boolean } => {
  const secret = process.env.AGENT_WALLET_SECRET;
  if (secret) {
    return { keypair: Keypair.fromSecretKey(bs58.decode(secret)), isEphemeral: false };
  }
  return { keypair: Keypair.generate(), isEphemeral: true };
};

const runAgentDemo = async () => {
  const { keypair, isEphemeral } = loadAgentWallet();
  const agentAddress = keypair.publicKey.toBase58();
  console.log(`[agentDemo] agent wallet: ${agentAddress}${isEphemeral ? " (ephemeral)" : ""}`);
  if (isEphemeral) {
    console.log(
      `[agentDemo] fund it with devnet USDC at ${DEVNET_USDC_FAUCET_URL} and pass AGENT_WALLET_SECRET to reuse a funded wallet`,
    );
  }

  const x402Client = createX402Client({
    wallet: {
      publicKey: keypair.publicKey,
      signTransaction: async (transaction: VersionedTransaction) => {
        transaction.sign([keypair]);
        return transaction;
      },
    },
    network: process.env.AGENT_X402_NETWORK === "solana" ? "solana" : "solana-devnet",
  });

  // Step 1: discover markets (plain HTTP, no auth, no payment).
  let chosenMarket = process.env.AGENT_MARKET;
  try {
    const marketsResponse = await fetch(`${GATEWAY_URL}/markets`);
    const marketsBody = await readJsonBody(marketsResponse);
    const markets = Array.isArray(marketsBody.markets)
      ? (marketsBody.markets as { slug?: string; usd_per_hour?: number }[])
      : [];
    if (marketsResponse.status !== 200 || markets.length === 0) {
      recordStep("discover markets", "FAIL", `status=${marketsResponse.status}`);
      return printSummaryAndExit();
    }
    if (!chosenMarket) {
      const pricedMarkets = markets.filter(
        (market) => typeof market.usd_per_hour === "number" && market.usd_per_hour > 0,
      );
      pricedMarkets.sort(
        (leftMarket, rightMarket) =>
          (leftMarket.usd_per_hour ?? 0) - (rightMarket.usd_per_hour ?? 0),
      );
      chosenMarket = pricedMarkets[0]?.slug;
    }
    if (!chosenMarket) {
      recordStep("discover markets", "FAIL", "no priced market found");
      return printSummaryAndExit();
    }
    recordStep("discover markets", "PASS", `${markets.length} markets, using "${chosenMarket}"`);
  } catch (discoveryError) {
    recordStep(
      "discover markets",
      "FAIL",
      `gateway unreachable at ${GATEWAY_URL}: ${discoveryError instanceof Error ? discoveryError.message : String(discoveryError)}`,
    );
    return printSummaryAndExit();
  }

  // Step 2: rent. The x402 client transparently answers the 402 by paying.
  let deploymentId = "";
  let session = "";
  try {
    const rentResponse = await x402Client.fetch(`${GATEWAY_URL}/rent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        market: chosenMarket,
        duration_minutes: AGENT_DURATION_MINUTES,
        job_definition: SIGN_OFF_JOB_DEFINITION,
      }),
    });
    const rentBody = await readJsonBody(rentResponse);
    if (rentResponse.status === 503) {
      recordStep("rent (pay 402)", "BLOCKED", `gateway refused before money moved: ${String(rentBody.error)}`);
      return printSummaryAndExit();
    }
    if (rentResponse.status === 402) {
      recordStep(
        "rent (pay 402)",
        "BLOCKED",
        `payment rejected (${String(rentBody.error)}); fund ${agentAddress} with devnet USDC at ${DEVNET_USDC_FAUCET_URL}`,
      );
      return printSummaryAndExit();
    }
    if (rentResponse.status !== 200 || typeof rentBody.deployment_id !== "string") {
      recordStep("rent (pay 402)", "FAIL", `status=${rentResponse.status} body=${JSON.stringify(rentBody).slice(0, 200)}`);
      return printSummaryAndExit();
    }
    deploymentId = rentBody.deployment_id;
    session = typeof rentBody.session === "string" ? rentBody.session : "";
    const payment =
      typeof rentBody.payment === "object" && rentBody.payment !== null
        ? (rentBody.payment as Record<string, unknown>)
        : {};
    recordStep(
      "rent (pay 402)",
      "PASS",
      `deployment=${deploymentId} paid=${String(payment.amount_usd)} USD tx=${String(payment.tx_signature)}`,
    );
  } catch (rentError) {
    recordStep(
      "rent (pay 402)",
      "BLOCKED",
      `payment could not be built (empty wallet?): ${rentError instanceof Error ? rentError.message : String(rentError)}`,
    );
    return printSummaryAndExit();
  }

  const sessionHeaders = { authorization: `Bearer ${session}` };

  // Step 3: poll status until the deployment reports RUNNING.
  let endpointUrl = "";
  const pollDeadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus = "unknown";
  while (Date.now() < pollDeadline) {
    const statusResponse = await fetch(`${GATEWAY_URL}/rent/${deploymentId}`, {
      headers: sessionHeaders,
    });
    const statusBody = await readJsonBody(statusResponse);
    if (statusResponse.status !== 200) {
      recordStep("poll until running", "FAIL", `status=${statusResponse.status} body=${JSON.stringify(statusBody).slice(0, 160)}`);
      return printSummaryAndExit();
    }
    lastStatus = String(statusBody.status);
    if (lastStatus === "RUNNING") {
      const endpoints = Array.isArray(statusBody.endpoints)
        ? (statusBody.endpoints as { url?: string }[])
        : [];
      endpointUrl = endpoints[0]?.url ?? "";
      break;
    }
    if (lastStatus === "ERROR" || lastStatus === "STOPPED") {
      recordStep("poll until running", "FAIL", `deployment ended in status ${lastStatus}`);
      return printSummaryAndExit();
    }
    console.log(`[agentDemo] waiting: deployment status is ${lastStatus}`);
    await waitMilliseconds(POLL_INTERVAL_MS);
  }
  if (lastStatus !== "RUNNING") {
    recordStep("poll until running", "FAIL", `timed out after ${POLL_TIMEOUT_MS / 1000}s in status ${lastStatus}`);
    return printSummaryAndExit();
  }
  recordStep("poll until running", "PASS", `RUNNING, endpoint=${endpointUrl || "(none listed)"}`);

  // Step 4: prove the rented compute answers HTTP.
  if (endpointUrl) {
    try {
      const endpointResponse = await fetch(endpointUrl);
      recordStep("hit deployment endpoint", "PASS", `HTTP ${endpointResponse.status} from ${endpointUrl}`);
    } catch (endpointError) {
      recordStep(
        "hit deployment endpoint",
        "FAIL",
        `unreachable: ${endpointError instanceof Error ? endpointError.message : String(endpointError)}`,
      );
    }
  } else {
    recordStep("hit deployment endpoint", "FAIL", "deployment listed no endpoint URL");
  }

  // Step 5: extend the rental (a second x402 payment).
  const extendResponse = await x402Client.fetch(`${GATEWAY_URL}/rent/${deploymentId}/extend`, {
    method: "POST",
    headers: { "content-type": "application/json", ...sessionHeaders },
    body: JSON.stringify({ duration_minutes: AGENT_DURATION_MINUTES }),
  });
  const extendBody = await readJsonBody(extendResponse);
  if (extendResponse.status === 200) {
    session = typeof extendBody.session === "string" ? extendBody.session : session;
    recordStep("extend (pay 402)", "PASS", `new timeout=${String(extendBody.timeout_minutes)} minutes`);
  } else {
    recordStep("extend (pay 402)", "FAIL", `status=${extendResponse.status} body=${JSON.stringify(extendBody).slice(0, 160)}`);
  }

  // Step 6: stop the rental.
  const stopResponse = await fetch(`${GATEWAY_URL}/rent/${deploymentId}/stop`, {
    method: "POST",
    headers: { authorization: `Bearer ${session}` },
  });
  const stopBody = await readJsonBody(stopResponse);
  if (stopResponse.status === 200) {
    recordStep("stop", "PASS", `final status=${String(stopBody.status)}`);
  } else {
    recordStep("stop", "FAIL", `status=${stopResponse.status} body=${JSON.stringify(stopBody).slice(0, 160)}`);
  }

  return printSummaryAndExit();
};

await runAgentDemo();
