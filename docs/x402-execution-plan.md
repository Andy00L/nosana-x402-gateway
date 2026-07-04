# x402 Gateway for Nosana: grounded execution plan

Date: 2026-07-04. This file is the concrete, code-level execution plan. It
complements `docs/x402-gateway-handoff.md` (the reviewed strategy) and
supersedes that file's "Next steps" section with steps grounded in Nosana's
actual open-source code and the verified x402 v2 wire format. Every load-bearing
technical claim carries a source.

---

## 0. The decisive finding (read this first)

The endpoint that must return `402 Payment Required` cannot be added to Nosana
by pull request, because the service that would host it is closed source.

Nosana's SDK config lists four backend services
(`@nosana/api` v2.7.0, `dist/defaults/index.js`):

- `client-manager` (`client-manager.k8s.prd.nosana.com`): hosts `/credits/*`,
  `/jobs/*`, and all `/payments/*` Stripe endpoints. Repo is not public
  (`github.com/nosana-ci/client-manager` returns 404). This is the service
  behind `dashboard.k8s.prd.nos.ci/api`, and it is where a 402 would live.
- `host-manager`: not public.
- `deployment-manager` (`deployment-manager.k8s.prd.nos.ci`): PUBLIC
  (`github.com/nosana-ci/nosana-deployment-manager`, Fastify plus MongoDB).
  Handles deployment lifecycle only, no billing. No LICENSE file, GitLab-internal
  merge requests, a single internal committer: not set up for external PRs.
- `blockchain-indexer`: the public `indexer` repo.

Consequences that shape this whole plan:

1. Nosana's "credits" are a Stripe (fiat) plus on-chain NOS/SOL rail today. There
   is no USDC and no x402 anywhere in their code.
2. An external contributor can only touch the public SDK (`nosana-kit`,
   MIT-licensed) and docs. The credits/jobs server is off-limits.
3. Therefore "a PR that enables Nosana to support x402" becomes two artifacts:
   a standalone x402 gateway (the product and the proof, built on the public
   SDK) plus an upstream proposal with a reference PR to `nosana-kit`.

Source: repo research pass, 2026-07-04. Key files verified:
`nosana-kit/packages/kit/src/utils/createApiInstance.ts`,
`@nosana/api` v2.7.0 tarball (`dist/routes/credits/index.js`,
`dist/routes/deployments/index.js`, `dist/client/createClient.js`).

---

## 1. Idea evaluation

Verdict: worth building. The idea survives scrutiny. Two things must stay honest.

Strong points:

- Real need, right primitive. Agent treasuries hold USDC, not NOS. x402 is
  HTTP-native, so an agent pays without knowing Solana exists.
- The par mapping. Nosana Credits are USD-denominated and x402 settles in USDC,
  so 1 credit maps to 1 USDC with no swap. Markets expose an hourly USD price
  (for example NVIDIA 3060 confirmed live on `GET /api/markets`), which makes
  server-side pricing concrete.
- Open lane. No official Nosana x402 support exists. The only third-party work is
  external wrappers (for example GPU-Bridge), which confirms the gap is unfilled
  at the source and validates the wrapper approach.

Two honesty constraints:

- Do not overclaim autonomy. An agent can already rent Nosana with zero humans
  today via the on-chain SDK (`jobs.post`, paying NOS). x402 does not unlock
  autonomy that did not exist. What it adds: USDC-native payment, a standard HTTP
  interface, and interop with every other x402 service. Pitch exactly that.
- "PR to Nosana" is a proposal plus a client helper, not a server endpoint
  change (see section 0). Frame it as such to the team and in the PR.

---

## 2. Architecture (grounded)

Pattern: a standalone gateway service in front of the public Nosana SDK. Zero
Nosana core changes. The gateway is the only new server.

```
AI agent (USDC wallet)
      | POST /rent  ->  402 Payment Required
      | sign USDC transfer, retry with PAYMENT-SIGNATURE
      v
x402 Gateway (Hono, this project)
      |  verify + settle via facilitator (PayAI)
      |  provision via @nosana/kit deployments.create()
      v
Nosana (credits-backed deployment)  ->  running GPU + HTTP endpoint
```

Money model for v1 (gateway treasury plus topped-up credits):

- The gateway operator holds a Nosana API key and a funded Nosana Credits
  balance (bought with fiat via their Stripe rail today) and a Solana treasury
  wallet that receives USDC.
- An incoming USDC payment is settled to the treasury; the gateway spends its own
  credits to provision. Reconciliation tracks USDC-in against credits-out. The
  par mapping keeps that accounting at 1:1.
- Native settlement (x402 topping up Nosana's credit ledger directly) is the
  later goal and belongs to Nosana's internal backend. It is out of scope for the
  external gateway.

---

## 3. Stack decision

Chosen for the gateway:

- Runtime and HTTP: Node plus Hono. Hono was chosen over Express because it also
  runs on Cloudflare Workers if we move there later; Express does not. Node (not
  Workers) for v1 because `@nosana/kit` targets Node (engines: Node >= 20.18) and
  Workers compatibility of the kit is unverified.
- Payments: `x402-solana` v2.0.4 (PayAI), used through its explicit
  `X402PaymentHandler` rather than an auto-middleware. Reason this matters: the
  official `@x402/hono` middleware settles AFTER the response is sent, which is
  wrong for GPU provisioning (an irreversible, expensive action). We must settle
  BEFORE provisioning, and the explicit handler gives that control. `x402-solana`
  is also fully source-confirmed, gasless, and needs no API key.
- Facilitator: PayAI (`https://facilitator.payai.network`) on devnet: gasless,
  no API keys, Solana devnet supported. Migration target for production is the
  CDP facilitator (`api.cdp.coinbase.com/platform/v2/x402`, requires CDP keys)
  or `x402.org/facilitator` for signup-free devnet testing.
- SDK: `@nosana/kit` v2.7.0 for `deployments.create()`, `credits.balance()`, and
  market lookup.
- Package manager: Bun for the gateway repo (house standard; runs Hono and the
  npm-published `@nosana/kit` and `x402-solana`). Phase 0 gate: confirm
  `@nosana/kit` imports and runs under Bun before committing to it; if a hard
  Node-only dependency blocks it, raise it as a decision rather than mixing
  package managers.

Verified x402 v2 facts to code against (do not use v1 shapes or memory):

- Header is `PAYMENT-SIGNATURE`, not `X-PAYMENT` (v1). Source: PayAI
  `payment-handler.ts` (`extractPayment`), CDP seller quickstart.
- Field is `amount` (atomic units), not `maxAmountRequired` (v1). Source: x402 v2
  spec PaymentRequirements table.
- SVM payload is a base64-encoded, partially-signed versioned Solana transaction
  at `payload.transaction`, not an EIP-3009 `authorization` object (that is EVM).
  Source: `specs/schemes/exact/scheme_exact_svm.md`.
- CAIP-2 network strings (use verbatim):
  - mainnet: `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`
  - devnet: `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`
  Source: CDP quickstart and PayAI code agree; docs.x402.org network reference.
- USDC mints: devnet `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`,
  mainnet `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`. USDC has 6 decimals, so
  the `exact` scheme carries `decimals: 6` for the TransferChecked instruction.

Two items to confirm against the installed `.d.ts` before shipping (flagged
UNCONFIRMED by research): PayAI free-tier settlement limits, and the exact
response header casing (`PAYMENT-RESPONSE` vs `X-PAYMENT-RESPONSE`).

### Phase 0 verification results (2026-07-04, run under Bun 1.3.14 in WSL)

The Phase 0 gate passed. Facts read from the installed packages and the live
API, superseding assumptions above where they differ:

- `@nosana/kit@2.7.0`, `x402-solana@2.0.4`, `hono@4.12.27` all import and run
  under Bun. The kit entry point is `createNosanaClient(network, customConfig?)`
  (a factory returning `NosanaClient`), not a class constructor.
- The kit already exports `generateIdempotencyKey`, `isNosanaApiError`, and
  `validateJobDefinition`: reuse these, do not write our own.
- `x402-solana/types` exports `SOLANA_DEVNET_CAIP2` and `SOLANA_MAINNET_CAIP2`
  constants plus `toCAIP2Network`: never hardcode the CAIP-2 strings.
- `X402ServerConfig` takes the simple network format (`"solana-devnet"`),
  `treasuryAddress`, `facilitatorUrl`, optional `apiKeyId`/`apiKeySecret`
  (their doc comment confirms a PayAI free tier exists and keys bypass its
  limits), optional `rpcUrl`, `defaultToken`, `defaultTimeoutSeconds`.
- `RouteConfig` is `{ amount, asset: { address, decimals }, description?,
  mimeType?, maxTimeoutSeconds? }` with `amount` in atomic units.
- CRITICAL, deployment `timeout` is in MINUTES, not seconds
  (`DeploymentCreateBody`: "Timeout in minutes, must be at least 1 minute").
  `name` is also required, and `strategy` is a union where `"SCHEDULED"`
  requires `schedule` and `"INFINITE"` requires a 60-minute minimum timeout.
  The gateway converts whatever unit `POST /rent` accepts into minutes here;
  getting this wrong is a 60x pricing error. sourceRef:
  `@nosana/api` `dist/client/deployment-manager/schema.d.ts`.
- Live market shape (both networks, 47 mainnet plus 4 devnet markets): the USD
  price field is `usd_reward_per_hour`. Each market also carries
  `network_fee_percentage` (10 on every market today), `slug` (friendly tier
  name like `nvidia-3090`: use these for agent-facing tier names instead of
  inventing a mapping), `address`, `name`, `type` (PREMIUM or COMMUNITY).
- OPEN pricing question for the team or Swagger: is the renter's price
  `usd_reward_per_hour` alone, or `usd_reward_per_hour` plus the
  `network_fee_percentage`? The gateway must charge what Nosana debits from
  credits, or reconciliation drifts. Resolve before Phase 1 sign-off.
- Devnet has a cheap test market (`scenario-test-dm`, 0.01 USD/hour) suitable
  for the sign-off loop.

---

## 4. The `POST /rent` flow, step by step

Request body (kept minimal for agents):

```
POST /rent
{
  "market": "<market slug (for example nvidia-3090) or market address>",
  "duration_minutes": 60,          // Nosana deployment timeout is in minutes
  "job_definition": { ... }        // image MUST serve an HTTP port (see section 9)
}
```

The agent-facing unit is minutes to match `DeploymentCreateBody.timeout`
exactly (one unit end to end, no conversion bug surface).

Step A, no `PAYMENT-SIGNATURE` header present:

1. Validate `market` against the live list from `GET /api/markets`. Reject an
   unknown market with a distinct error (never trust a client-supplied market).
2. Compute the price server-side:
   `usd_reward_per_hour * (duration_minutes / 60)`, plus the network fee if the
   open pricing question resolves that way, converted to USDC atomic units
   (6 decimals) with `toAtomicUnits`. This is `amount`. Never read a price from
   the request body.
3. Check the gateway credits balance covers the demand
   (`client.api.credits.balance()`). If it cannot, refuse to issue the 402 with a
   distinct "gateway capacity" error rather than taking money it cannot fulfil.
4. Return 402 with the v2 PaymentRequirements (filled devnet example):

```json
{
  "x402Version": 2,
  "resource": { "url": "https://gateway/rent", "description": "GPU rental", "mimeType": "application/json" },
  "accepts": [{
    "scheme": "exact",
    "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    "amount": "2500000",
    "asset": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    "payTo": "<treasury pubkey>",
    "maxTimeoutSeconds": 300,
    "extra": { "feePayer": "<facilitator fee-payer pubkey, from facilitator>" }
  }],
  "error": "Payment required"
}
```

Step B, `PAYMENT-SIGNATURE` header present:

1. `extractPayment(headers)` then `verifyPayment(header, requirements)`. On
   `isValid: false`, return 402 with the facilitator's `invalidReason` (distinct
   messages per failure mode).
2. Settle BEFORE provisioning: `settlePayment(header, requirements)`. Require
   `success: true` and capture the base58 transaction signature. Settle-before-
   provision is deliberate: verify only checks validity, not on-chain finality,
   so provisioning on verify alone risks handing out a GPU for a payment that
   later fails to settle.
3. Anti-replay: look up the settled transaction signature (and the payload nonce)
   in a persistent store. If seen, reject as a replay. Otherwise record it before
   provisioning.
4. Provision through the SDK:
   `deployments.create({ market, timeout, job_definition, replicas: 1, strategy: "SIMPLE" })`.
5. If provisioning fails after a successful settle, enter the refund path
   (section 6). On devnet this may log and flag; before mainnet it must refund.
6. Mint a session JWT holding `{ deployment_id, payer_pubkey, tx_sig, exp }` and
   return `{ deployment_id, endpoint, session }`.

Lifecycle endpoints (Phase 2), each authenticated by the session JWT:

- `GET /rent/:id`: status plus endpoint.
- `POST /rent/:id/extend`: 402, then `extend-with-credits`.
- `POST /rent/:id/stop`: `stop-with-credits`, refund unused time.
- `GET /markets`: GPU tiers plus USD price, for discovery.

Illustrative handler sketch (plan-level, not the final code; names and
errors-as-values follow the project standards):

```ts
// [handleRentRequest] one endpoint: quote, then pay-and-provision.
app.post("/rent", async (context) => {
  const rentRequest = await parseRentRequest(context);
  if (!rentRequest.ok) return jsonError(context, 400, rentRequest.reason);

  const marketCheck = await validateMarketAgainstList(rentRequest.value.market);
  if (!marketCheck.ok) return jsonError(context, 400, marketCheck.reason);

  const priceQuote = await priceRentServerSide(rentRequest.value, marketCheck.value);
  const requirements = await x402Handler.createPaymentRequirements(priceQuote, resourceUrl);

  const paymentHeader = x402Handler.extractPayment(context.req.raw.headers);
  if (!paymentHeader) {
    const capacity = await gatewayCanCoverDemand(priceQuote);
    if (!capacity.ok) return jsonError(context, 503, capacity.reason);
    return context.json(x402Handler.create402Response(requirements, resourceUrl).body, 402);
  }

  const verification = await x402Handler.verifyPayment(paymentHeader, requirements);
  if (!verification.isValid) return jsonError(context, 402, verification.invalidReason ?? "invalid payment");

  const settlement = await x402Handler.settlePayment(paymentHeader, requirements);
  if (!settlement.success) return jsonError(context, 402, settlement.errorReason ?? "settlement failed");

  const replay = await recordSettlementOrRejectReplay(settlement.transaction);
  if (!replay.ok) return jsonError(context, 409, replay.reason);

  const provision = await provisionNosanaDeployment(rentRequest.value);
  if (!provision.ok) {
    await enqueueRefund(settlement.transaction, priceQuote); // paid-but-provision-failed
    return jsonError(context, 502, "provisioning failed, refund queued");
  }

  const session = signRentSession(provision.value.deploymentId, verification.payer, settlement.transaction);
  return context.json({ deployment_id: provision.value.deploymentId, endpoint: provision.value.endpoint, session });
});
```

---

## 5. Simplification for AI agents

The agent should do one thing: `POST /rent`, handle a 402, pay, get an endpoint.
Everything else is hidden. To make that real:

- A tiny client example so the agent flow is: call, on 402 use the x402 client
  helper to sign and retry, receive the endpoint. Ship it in the repo README and
  as a runnable script.
- Friendly GPU tier names (for example `rtx-3060`) mapped to market pubkeys
  server-side, so the agent does not need to know Solana market addresses.
- Sensible defaults: `replicas: 1`, `strategy: "SIMPLE"`, a small default image.
- An idempotency key on `POST /rent` so a client retry after a network blip does
  not double-provision. Same key plus same body returns the same result.
- Distinct, actionable errors: "unknown market", "gateway capacity", "invalid
  payment", "settlement failed", "provisioning failed" are never the same string.

---

## 6. Edge cases and failure paths (handle in the same commit as the happy path)

- Quote expiry. `maxTimeoutSeconds` bounds the quote window (default 300s). The
  payer's signed transaction also expires with its blockhash (about 150 slots),
  which is the real hard limit. Re-quote past it; a stale blockhash makes settle
  fail with a distinct error.
- Paid but provisioning failed. x402 is a push payment. If `deployments.create`
  fails after settle (market full, gateway credits empty), the agent paid for
  nothing. The refund path must exist as soon as real money moves. On devnet it
  may log and flag; lock a real refund before mainnet.
- Underfunded gateway. Monitor the credits balance and refuse the 402 whose
  demand the balance cannot cover (step A.3). Never accept a payment the gateway
  cannot fulfil.
- Replay. The scheme adds a Memo nonce for uniqueness, and a spent transaction
  cannot re-execute on-chain, but nothing stops a client resending the same
  `PAYMENT-SIGNATURE` before the first settles. Dedupe server-side on the settled
  signature and the nonce (step B.3).
- Concurrent rents and payment races. Two requests with the same idempotency key,
  or two settles for one deployment: the settlement store and idempotency key are
  the guards. Make the record-before-provision write atomic.
- Facilitator down or slow. Wrap verify and settle in timeout plus bounded retry
  with backoff. Distinguish transient (429, 503, timeout) from permanent (400).
- Restart after crash between settle and provision. On restart, a settled-but-
  unprovisioned record must either complete provisioning or refund. Persist the
  settlement record before provisioning so this is recoverable.

---

## 7. Security (payments trust boundary)

This project touches payments, so the full audit procedure in
`.claude/REFERENCE_SECURITY_AUDIT.md` triggers once building starts. Design these
in from the first commit:

- Server-side pricing only. The `amount` is computed on the gateway from
  `GET /api/markets`, never from client input. The `market` is validated against
  the real list.
- Anti-replay store for settled transaction signatures and payload nonces.
- Settle before provision, with a refund/compensation path for settle-fail-after-
  provision and paid-but-provision-failed.
- Session JWT signing key in an environment variable or a secret manager, never
  in code. Short expiry, claims scoped to one deployment.
- Treasury and refund hot-wallet keys in env or KMS, never in code or logs.
- Facilitator `feePayer` read from the facilitator, never hardcoded (the safety
  rule requires the fee payer not appear in any instruction's accounts).
- No secrets in logs. Every log line carries a `[FunctionName]` prefix. Business
  logic returns errors as values, not thrown exceptions.
- Input validation, TLS, and rate limiting on every public route.

---

## 8. The "valid PR" strategy

Given the closed backend, the credible contribution is a set, ordered by
likelihood of landing:

1. The gateway repo itself (your product and proof): MIT-licensed, tested,
   deployed on devnet, with a runnable agent demo. This is the artifact everything
   else references.
2. An RFC issue on `nosana-ci/nosana-kit` proposing native x402 support, linking
   the gateway as the reference implementation. Lead with this, because the team
   already gave verbal support and the repos are GitLab-first mirrors with no
   external PR history.
3. A reference PR to `nosana-kit` `packages/kit`: a client-side x402 helper at the
   seam research identified (`packages/kit/src/utils/createApiInstance.ts` and the
   `createAuthenticatedClient` middleware where request headers attach). It adds an
   opt-in 402-catch-and-pay interceptor plus an `x402` helper module. Because the
   core HTTP client `@nosana/api` source is not mirrored to public GitHub, the
   helper lives in `packages/kit` and wraps the public client surface. Match the
   repo conventions exactly: pnpm workspace, Vitest tests, ESLint config, TypeDoc,
   MIT. Frame it as "client helper; the server-side 402 is emitted by the internal
   client-manager".
4. Optionally a docs PR to `docs.nosana.com` documenting the rental flow.

Do not invest in a `deployment-manager` server-side 402 PR: wrong layer (billing
lives in the closed client-manager), no LICENSE file, GitLab-internal merge flow.

Note on the reference PR toolchain: the gateway repo uses Bun (house standard),
but the `nosana-kit` PR must use that repo's pnpm plus Vitest, per the rule to
match the conventions of the repository you contribute to.

---

## 9. Phase 1 sign-off test

A mock x402 agent pays devnet USDC, gets a running deployment whose image serves
an HTTP port, polls the endpoint, extends, then stops. The full no-human loop is
proven. Use a job definition whose image serves a port (a small web server), not
a bare `ubuntu` hello-world, which exposes nothing to poll.

---

## 10. Phased milestones

- Phase 0: confirm decisions. Node plus Hono host, PayAI facilitator on devnet,
  market and pricing source. Verify `@nosana/kit` runs under Bun. Read the
  installed `x402-solana` `.d.ts` to confirm the two UNCONFIRMED items.
- Phase 1: the `POST /rent` loop on devnet with server-side pricing, quote expiry,
  settle-before-provision, anti-replay, paid-but-provision-failed handling, and
  the JWT session. Pass the sign-off test.
- Phase 2: lifecycle (`status`, `extend`, `stop`, `markets`) plus refund of unused
  time.
- Phase 3: reconciliation (USDC-in vs credits-out) and a credits-balance monitor.
- Phase 4: upstream. RFC issue plus the reference PR to `nosana-kit` plus docs.
- Phase 5: hardening and mainnet gating. Real refund path, CDP facilitator for
  production, rate limits, optional x402 Bazaar listing.

---

## 11. Open decisions to confirm with the team

1. Reconciliation boundary: native credit-ledger settlement (their internal
   backend) vs gateway-treasury plus topped-up credits (v1, external).
2. Where they want the client helper to live long term: a `packages/kit` module,
   a new `@nosana/x402` package, or their internal client-manager.
3. On-chain fulfilment mode (paying NOS via `jobs.post` instead of credits): in
   scope for v1 or a later milestone. The credits path is faster for v1.
4. Grant: confirm the Nosana Foundation amount and the current open cycle via
   Discord and the blog, after the Phase 1 proof, per the "build proof first"
   note in the handoff.

---

## 12. Immediate next steps

1. Scaffold the gateway repo (Bun plus Hono) inside this project tree, after
   confirming `@nosana/kit` runs under Bun.
2. Wire the `x402-solana` `X402PaymentHandler` and the PayAI devnet facilitator.
3. Build the `POST /rent` step A (quote and 402) with server-side pricing first,
   then step B (verify, settle-before-provision, anti-replay, provision, session).
4. Write the mock-agent sign-off test with an HTTP-serving image.
5. Only then draft the RFC issue and the `nosana-kit` reference PR.
