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
import {
  createRateLimiter,
  createRateLimitMiddleware,
} from "./lib/rateLimit.js";
import { reportRefundsOwed } from "./lib/refundScan.js";
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
// with no deployment. Surface each one loudly; these are refunds owed. The
// operator lists and closes them through GET /admin/refunds.
reportRefundsOwed(settlementStore);

// Refund sweep cadence in milliseconds. The same scan re-runs on a timer so a
// provision failure that happens while the gateway is up surfaces within
// minutes, not only at the next restart.
const REFUND_SCAN_INTERVAL_MS = 10 * 60 * 1000;
setInterval(() => reportRefundsOwed(settlementStore), REFUND_SCAN_INTERVAL_MS);
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

// One shared budget for the whole public quote and rent surface (GET /markets
// and every POST /rent, paid or not): a scraper alternating between paths
// cannot double its allowance, and a garbage payment header buys no exemption.
const publicRateLimiter = createRateLimiter();

// Root discovery: the whole x402 rent flow on one page, so an agent can orient
// (headers, ordered steps, every endpoint) before it makes any request.
app.get("/", (context) => context.json(buildServiceDescription(config.x402Network)));
app.get("/health", (context) => context.json({ status: "ok" }));
app.route(
  "/markets",
  createMarketsRouter(
    marketsService,
    availabilityService,
    createRateLimitMiddleware(publicRateLimiter, config.trustProxy),
  ),
);
app.route(
  "/rent",
  createRentRouter({
    config,
    marketsService,
    availabilityService,
    x402Handler,
    settlementStore,
    provisioningService,
    publicRateLimiter,
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
// connection with no bytes moving, which the paid path can legitimately exceed
// (no byte leaves until the receipt is ready). A connection cut after settle
// loses the agent's receipt (deployment id, session, refund tx), observed once
// in the 2026-07-08 mainnet sign-off log
// (docs/evidence/2026-07-08-mainnet-signoff.txt). Worst-case paid chain with
// every call at its budget: requirements 30 + verify 30 (x402.ts
// FACILITATOR_CALL_TIMEOUT_MS) + settle 60 (SETTLE_CALL_TIMEOUT_MS) + pin 60 +
// create 60 (provisioning.ts NOSANA_CALL_TIMEOUT_MS) = 240s. Bun caps the
// setting at 255, so 250 is the margin that fits.
const CONNECTION_IDLE_TIMEOUT_SECONDS = 250;

export default {
  port: config.port,
  fetch: app.fetch,
  idleTimeout: CONNECTION_IDLE_TIMEOUT_SECONDS,
};
