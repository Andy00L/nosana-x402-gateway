import { Hono } from "hono";
import { createNosanaClient } from "@nosana/kit";
import { loadGatewayConfig } from "./config.js";
import { createMarketsService } from "./lib/markets.js";
import { buildX402Handler } from "./lib/x402.js";
import { createRentRouter } from "./routes/rent.js";
import { createMarketsRouter } from "./routes/markets.js";

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

const app = new Hono();

app.get("/health", (context) => context.json({ status: "ok" }));
app.route("/markets", createMarketsRouter(marketsService));
app.route("/rent", createRentRouter({ config, marketsService, x402Handler }));

console.log(
  `[startGateway] nosana-x402-gateway on port ${config.port}: network=${config.x402Network} facilitator=${config.facilitatorUrl} payTo=${config.treasuryAddress}`,
);

export default {
  port: config.port,
  fetch: app.fetch,
};
