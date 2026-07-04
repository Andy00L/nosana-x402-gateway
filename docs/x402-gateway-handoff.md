# x402 Gateway for Nosana: Project Handoff (reviewed)

Status of this file: this is the working source of truth for the x402 gateway
project. It holds the original plan (preserved) plus a review pass dated
2026-07-04 that verified every technical claim against official sources. A new
session should read this file first, then start from the "Next steps for the
continuing session" section at the bottom.

Repository state at handoff time: empty except for the `.claude` standards kit.
No code scaffolded yet.

---

## TL;DR

Build an x402 payment gateway so any AI agent can rent Nosana GPU compute by
paying USDC over plain HTTP: no human in the loop, no Solana/NOS/IPFS knowledge
required. The Nosana team agreed to add it as a default integration. Targeting a
Nosana Foundation grant for the native-integration work.

---

## What we want to do

Expose a single HTTP endpoint (`POST /rent`) that speaks the x402 protocol. An
agent calls it, gets a `402 Payment Required`, pays in USDC on Solana, and
receives a running GPU deployment plus endpoint back. The gateway hides all
Nosana internals (markets, NOS escrow, IPFS job definitions).

## Why x402 (the actual value)

An agent can already rent Nosana with zero humans today via the on-chain SDK
(`jobs.post`, pays NOS). x402 is not what unlocks autonomy. What it adds:

1. USDC-native payment: agent treasuries hold USDC, not NOS.
2. Standard HTTP interface: any x402 agent rents compute knowing nothing about
   Solana or NOS.
3. Interop: the same payment flow the agent uses for every other paid service.

---

## Key technical context (verified 2026-07-04)

Nosana has two payment rails:

- On-chain (NOS + SOL): `client.jobs.post({ market, timeout, ipfsHash })`.
  Escrows NOS at the market's per-second rate; node runs the Docker job; results
  to IPFS. Permissionless, no account.
- Hosted API + Credits (dollar-denominated): REST API with API-key or
  wallet-signature auth. Pay from a Credits balance. Higher-level `deployments`
  API (replicas, lifecycle) plus Vaults for wallet-based deployments.

The lucky alignment: Credits are USD-denominated and x402 settles in USDC, so
the mapping is par with no swap needed on the credits path. Confirmed: the
markets API returns an hourly USD price per market (for example H100 at about
1.36 USD/hour), which is what makes the par mapping concrete.

x402 on Solana: supports all SPL tokens (USDC is default). Facilitators: PayAI
(Solana-first, gasless, all tokens) or CDP/Coinbase (Solana supported). Stateless
by design: request, then 402, then sign transfer, then verify, then serve.

Known values (all re-checked against source on 2026-07-04):

- Nosana API base: `https://dashboard.k8s.prd.nos.ci/api` (Swagger at `/api/swagger`).
- Endpoints: `POST /api/jobs/create-with-credits` (confirmed in docs),
  `.../extend-with-credits`, `.../stop-with-credits`, `GET /api/credits/balance`.
  See the "Open items" note: only `create-with-credits` was confirmed by exact
  path; extend and stop are confirmed as capabilities but their exact paths still
  need reading from Swagger.
- USDC mint, devnet: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (Circle,
  confirmed on the Solana devnet explorer).
- USDC mint, mainnet: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (Circle canonical).
- Example cheap market (3060): `7AtiXMSH6R1jjBxrcYjehCkkSF7zvYWte63gwEDBcGHq`
  (confirmed live on `GET /api/markets` as "NVIDIA 3060").

---

## Architecture decisions

- Pattern: gateway/proxy in front of Nosana. Zero core changes for v1.
- Fulfillment: use the credits/deployments API for v1 (faster, Nosana handles
  orchestration, endpoints, replicas). Add on-chain mode later for the
  fully-trustless path.
- Flow, pay-then-rent, NOT register-first: stateless payment is the default
  (x402's whole point). But compute is not a single request (duration, async
  endpoint, extend/refund), so the payment mints a lightweight session (JWT or a
  Nosana Vault keyed to the agent pubkey) to manage the running job. No signup
  ceremony.

---

## Build plan (phased)

Stack: Node + Hono (pick Hono, not Express, if hosting on Cloudflare Workers:
Express does not run on Workers) with `x402-solana` v2 plus a facilitator
(PayAI or CDP), `@nosana/kit`, USDC on Solana.

- Phase 1, core rent loop (v1, credits-backed, devnet):
  - `POST /rent` (body: `job_definition`, `market`, `timeout`).
  - No `X-PAYMENT` header: price it (market rate times timeout, USDC 1:1 to
    credit dollars, priced server-side from `GET /api/markets`), then return a
    402 with the v2 PaymentRequirements shape (see the correction below on field
    names and network format).
  - With `X-PAYMENT`: `facilitator.verify`, then settle, then
    `deployments.create({ market, timeout, job_definition, replicas: 1, strategy: "SIMPLE" })`,
    then return `{ deployment_id, endpoint, session }`.
  - `session` is a JWT holding `deployment_id` plus payer pubkey.

- Phase 2, lifecycle:
  - `GET /rent/:id` (status plus endpoint).
  - `POST /rent/:id/extend` (402, then `extend-with-credits`).
  - `POST /rent/:id/stop` (`stop-with-credits` plus refund unused).
  - `GET /markets` (GPU tiers plus USD price, for discovery).

- Phase 3, reconciliation (align with team):
  - v1: gateway treasury collects USDC; keep a Nosana credits balance topped up;
    track USDC-in versus credits-out.
  - Native: 402 settles directly into Nosana's credit ledger (x402 becomes a
    USDC-to-credits top-up rail). Gateway owns middleware plus verification;
    their backend wires settlement to ledger. This boundary is the main thing to
    lock with the team.

- Phase 4, hardening:
  - Idempotency (one provision per payment nonce; store settled tx sigs to block
    replays).
  - Refund path (early stop or failed placement).
  - Optional on-chain fulfillment mode.
  - List endpoint in x402 Bazaar.

- Phase 5, upstream:
  - Confirm placement (`@nosana/x402` kit module versus gateway service in their
    infra).
  - Tests (concurrent rents, payment races).
  - Docs page (see corrected link below) and PR.

Phase 1 sign-off test: a mock x402 agent pays devnet USDC, gets a running
deployment whose image exposes an HTTP port, polls the endpoint, extends, stops.
Full no-human loop proven. (Correction: do not use a bare `ubuntu` hello-world
image for this; it exposes no endpoint to poll. Use an image that serves a port.)

---

## Review notes (2026-07-04, verified against sources)

### Verified correct

- `x402-solana` exists: v2.0.4, published February 2026, framework-agnostic
  implementation of the x402 payment protocol v2 for Solana clients and servers.
- `@nosana/kit` exists: v2.7.0.
- Nosana credits/deployments API confirmed: `jobs/create-with-credits`, API-key
  auth, `client.api.credits.balance()`, `client.deployments.create()`. Base URL
  `https://dashboard.k8s.prd.nos.ci/api` is the one the official docs cite.
- Market `7AtiXMSH6R1jjBxrcYjehCkkSF7zvYWte63gwEDBcGHq` responds on
  `GET /api/markets` as "NVIDIA 3060". Markets expose an hourly USD price, which
  confirms the par mapping to credits with no swap.
- USDC mints (devnet and mainnet) confirmed against Circle and the Solana explorer.
- PayAI: Solana plus devnet facilitator, gasless, free tier 10,000 settlements
  per month, then 0.001 USD per settlement.
- Prior art: the only public GitHub repo tagged both `nosana` and `x402` is
  `iamaanahmad/The-Solana-Sentinel`, a token risk-analysis agent, 0 stars. It is
  not a GPU-rental gateway, so there is no duplication. The lane is open.
- Cloudflare Workers free tier figures (100k requests/day, 10 ms CPU) and the
  CPU-time versus wall-time nuance are accurate.

### Errors to fix in the plan

1. The Phase 1 402 payload was written in x402 v1 shape. `x402-solana` v2.x
   implements protocol v2, whose PaymentRequirements uses:
   - `network` in CAIP-2 format (for example `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`
     for mainnet; read the exact devnet CAIP-2 reference from the v2 spec, do not
     invent it), not the plain string `"solana"` or `"solana-devnet"`.
   - the field is named `amount` (v1 used `maxAmountRequired`).
   - the `exact` scheme is defined for SVM (via `TransferChecked`, spec section
     6.2), so the scheme choice is correct; only the surrounding shape needs the
     v2 names.
   Action: code against the v2 PaymentRequirements type exported by
   `x402-solana`, do not hand-roll the v1 JSON from the original plan.

2. "CDP: free settlement on Solana" is too optimistic. The CDP facilitator gives
   1,000 free transactions per month, then 0.001 USD per transaction. PayAI is
   more generous (10,000 per month). Both are fine for a devnet PoC; the plan's
   wording is inaccurate.

3. Dead link: `docs.nosana.com` now redirects to `learn.nosana.com`. The Phase 5
   docs target is the new domain. Note that `docs.nosana.io` also still serves
   content; confirm with the team which domain is canonical before writing a docs
   PR.

### Gaps to add (each is one line in the plan, all load-bearing before mainnet)

1. Quote expiry. Market prices move with the NOS/USD rate. Between the 402 sent
   and the signed payment, the price can change. Use the v2 `maxTimeoutSeconds`
   field to bound quote validity and re-quote past it. The plan covers idempotency
   but not this.
2. Paid but provisioning failed. x402 is a push payment: if `deployments.create`
   fails after settlement (market full, gateway credits empty), the agent paid
   for nothing. The plan puts refund in Phase 4, but this path must exist as soon
   as real money moves. On devnet it is acceptable to defer; lock it before
   mainnet. Corollary, also missing: monitor the gateway credits balance and
   refuse to serve a 402 whose demand the balance cannot cover.
3. Sign-off test image. A bare `ubuntu` hello-world exposes no HTTP endpoint to
   poll. Use a job definition whose image serves a port (a small web server) so
   the "polls endpoint" step is testable.
4. Server-side pricing, stated explicitly. The 402 amount is computed from
   `GET /api/markets` on the gateway, never from a client-supplied value. The
   `market` the agent passes is validated against the real market list.

### Coherence notes (not errors)

- If hosting on Cloudflare Workers, choose Hono, not Express (Express does not
  run on Workers). The original plan said "or"; pick Hono for that target.
- This project touches payments, so the full audit procedure in
  `.claude/REFERENCE_SECURITY_AUDIT.md` triggers once building starts. The
  session-signing JWT key, the refund hot wallet, and anti-replay on settled tx
  signatures are the trust-boundary items to design in from the start (all three
  are already named in the plan or trivial to add).

### Not verifiable remotely (confirm during build)

- Grant amount (Nosana Foundation, cited as 5K-50K USD in NOS or credits) and the
  current open cycle: confirm via Discord and the Nosana blog, as the plan already
  intends.
- Swagger UI at `/api/swagger` returned 404 to a raw fetch (likely a
  browser-only UI). Open it manually to confirm the exact paths of
  `extend-with-credits` and `stop-with-credits`. Only `create-with-credits` was
  confirmed by exact path; extend and stop are confirmed as capabilities via
  Nosana's own "list, extend, and stop jobs" announcement but their exact paths
  are unread.

---

## Open decisions to nail with the team

1. Reconciliation boundary: native credit-ledger settlement (their backend)
   versus gateway-treasury plus topped-up credits (v1)?
2. Final code placement: `@nosana/x402` module in the SDK versus a gateway
   service in Nosana infra?
3. On-chain fulfillment mode: in scope for v1 or a later milestone?

---

## Next steps for the continuing session

1. Read this whole file, then read `.claude/CLAUDE.md` and its two imported
   standards documents (the session-start proof is mandatory before any code).
2. Open the Swagger UI in a browser and record the exact request/response shapes
   of `create-with-credits`, `extend-with-credits`, `stop-with-credits`,
   `credits/balance`. Write them into this file.
3. Read the `x402-solana` v2 README and the v2 spec PaymentRequirements type;
   confirm the devnet CAIP-2 network reference and the exact 402 field names.
4. Decide Hono on Cloudflare Workers versus Node for the PoC host, then scaffold
   Phase 1 on devnet (this is a gateway/API, so the Next.js frontend rule in
   SKILL_GENERAL does not apply here).
5. Build the Phase 1 `POST /rent` loop with server-side pricing, quote expiry,
   and the paid-but-provision-failed refund path wired in from the start.
6. Run the Phase 1 sign-off test with an HTTP-serving image.
7. Only then apply for the grant, per the plan's own "build proof first" note.

---

## Resources

- Nosana Kit: https://github.com/nosana-ci/nosana-kit
- Nosana docs: https://learn.nosana.com (formerly docs.nosana.com) and
  https://docs.nosana.io (confirm canonical with team)
- Nosana kit docs: https://kit.nosana.com
- Nosana Swagger: https://dashboard.k8s.prd.nos.ci/api/swagger
- x402 on Solana (guide): https://solana.com/developers/guides/getstarted/intro-to-x402
- x402 spec (v2): https://github.com/coinbase/x402 (specs/x402-specification-v2.md)
- x402 site: https://x402.org
- Facilitators: PayAI https://facilitator.payai.network , CDP https://docs.cdp.coinbase.com/x402/welcome
- npm: `x402-solana` (v2.0.4), `@nosana/kit` (v2.7.0)
