import { Hono } from "hono";
import { createNosanaClient } from "@nosana/kit";
import { loadGatewayConfig } from "./config.js";
import { createMarketsService } from "./lib/markets.js";
import { buildX402Handler } from "./lib/x402.js";
import { createSettlementStore } from "./lib/settlementStore.js";
import { createProvisioningService } from "./lib/provisioning.js";
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

app.get("/health", (context) => context.json({ status: "ok" }));
app.route("/markets", createMarketsRouter(marketsService));
app.route(
  "/rent",
  createRentRouter({ config, marketsService, x402Handler, settlementStore, provisioningService }),
);
app.route(
  "/admin",
  createAdminRouter({ config, settlementStore, creditsSource: provisioningService }),
);

console.log(
  `[startGateway] nosana-x402-gateway on port ${config.port}: network=${config.x402Network} facilitator=${config.facilitatorUrl} payTo=${config.treasuryAddress}`,
);

export default {
  port: config.port,
  fetch: app.fetch,
};
