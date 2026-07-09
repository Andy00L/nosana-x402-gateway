import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createNosanaClient } from "@nosana/kit";
import { loadGatewayConfig } from "./config.js";
import { createMarketsService } from "./lib/markets.js";
import { buildX402Handler } from "./lib/x402.js";
import { createSettlementStore } from "./lib/settlementStore.js";
import { createProvisioningService } from "./lib/provisioning.js";
import { createAvailabilityService, type MarketQueueSource } from "./lib/availability.js";
import { buildServiceDescription } from "./lib/agentGuide.js";
import { ok, err } from "./lib/result.js";
import { withTimeout } from "./lib/withTimeout.js";
import { createRentRouter } from "./routes/rent.js";
import { createMarketsRouter } from "./routes/markets.js";
import { createAdminRouter } from "./routes/admin.js";

const configResult = loadGatewayConfig(process.env);
if (!configResult.ok) {
  // Crash early on bad configuration instead of misbehaving silently.
  console.error(`[startGateway] configuration error: ${configResult.reason}`);
  process.exit(1);
}
const config = configResult.value;

const nosanaClient = createNosanaClient(config.nosanaNetwork);
const marketsService = createMarketsService(nosanaClient);

// On-chain market-queue read budget in milliseconds. Shorter than the 60s
// provisioning budget because this read sits on the discovery and quote hot
// paths; a hung RPC degrades availability to "unknown" instead of pinning the
// request.
const MARKET_QUEUE_READ_TIMEOUT_MS = 15_000;

// Adapt the kit's on-chain jobs reader (branded Solana Address and enum types)
// to the availability service's plain string/number contract. One
// getProgramAccounts call returns every market's queue; a transient RPC failure
// becomes an err value so the discovery and quote paths degrade to "unknown"
// rather than throwing. No API key is needed: this is a public chain read.
const marketQueueSource: MarketQueueSource = {
  readAllMarketQueues: async () => {
    try {
      const markets = await withTimeout(
        nosanaClient.jobs.markets(),
        "jobs.markets",
        MARKET_QUEUE_READ_TIMEOUT_MS,
      );
      return ok(
        markets.map((market) => ({
          address: market.address,
          queueType: market.queueType,
          queueLength: market.queue.length,
        })),
      );
    } catch (queueError) {
      const message = queueError instanceof Error ? queueError.message : String(queueError);
      return err(`on-chain market queues read failed: ${message}`);
    }
  },
};
const availabilityService = createAvailabilityService(marketQueueSource);

const x402Handler = buildX402Handler(config);
const settlementStore = createSettlementStore(config.settlementDbPath);
const provisioningService = createProvisioningService(config);

// Restart recovery: a crash between settle and provision leaves a paid record
// with no deployment. Surface each one loudly; these are refunds owed.
const paidWithoutDeployment = settlementStore.listPaidWithoutDeployment();
if (paidWithoutDeployment.length > 0) {
  console.error(
    `[startGateway] REFUNDS OWED: ${paidWithoutDeployment.length} settled payment(s) without a running deployment`,
  );
  for (const record of paidWithoutDeployment) {
    console.error(
      `[startGateway] refund owed: tx=${record.txSignature} payer=${record.payer} amountAtomic=${record.amountAtomic} market=${record.marketSlug}`,
    );
  }
}
if (!provisioningService.isConfigured) {
  console.warn(
    "[startGateway] NOSANA_API_KEY is not set: quotes are served but every payment is refused before settlement",
  );
}

const app = new Hono();

// Cap request bodies before any handler reads them. Job definitions are small
// JSON; 128 KiB is generous and blocks a memory-exhaustion DoS on the money
// paths (POST /rent and extend parse JSON bodies).
const MAX_REQUEST_BODY_BYTES = 128 * 1024;
app.use(
  "*",
  bodyLimit({
    maxSize: MAX_REQUEST_BODY_BYTES,
    onError: (context) => context.json({ error: "request body too large" }, 413),
  }),
);

// Root discovery: the whole x402 rent flow on one page, so an agent can orient
// (headers, ordered steps, every endpoint) before it makes any request.
app.get("/", (context) => context.json(buildServiceDescription(config.x402Network)));
app.get("/health", (context) => context.json({ status: "ok" }));
app.route("/markets", createMarketsRouter(marketsService, availabilityService));
app.route(
  "/rent",
  createRentRouter({
    config,
    marketsService,
    availabilityService,
    x402Handler,
    settlementStore,
    provisioningService,
  }),
);
app.route(
  "/admin",
  createAdminRouter({ config, settlementStore, creditsSource: provisioningService }),
);

console.log(
  `[startGateway] nosana-x402-gateway on port ${config.port}: network=${config.x402Network} facilitator=${config.facilitatorUrl} payTo=${config.treasuryAddress}`,
);

// Connection idle ceiling in seconds. Bun.serve defaults to 10s and kills any
// connection with no bytes moving, which the paid path can legitimately exceed:
// it chains facilitator verify + settle and Nosana pin + create, each Nosana
// call budgeted at 60s (provisioning.ts NOSANA_CALL_TIMEOUT_MS). A connection
// cut after settle loses the agent's receipt (deployment id, session, refund
// tx), observed once in the 2026-07-08 mainnet sign-off log
// (docs/evidence/2026-07-08-mainnet-signoff.txt). 180s covers two chained
// 60s budgets plus facilitator round-trips; Bun caps the setting at 255.
const CONNECTION_IDLE_TIMEOUT_SECONDS = 180;

export default {
  port: config.port,
  fetch: app.fetch,
  idleTimeout: CONNECTION_IDLE_TIMEOUT_SECONDS,
};
