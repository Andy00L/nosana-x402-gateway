<p align="center">
  <img src="docs/assets/icon.svg" width="88" alt="nosana-x402-gateway icon">
</p>

<h1 align="center">nosana-x402-gateway</h1>

<p align="center">
  An HTTP 402 payment gateway that lets any AI agent rent Nosana GPU compute by
  paying USDC on Solana, with no Nosana account, no NOS token, and no Solana SDK
  on the agent side. The gateway prices each job from Nosana's live market rate,
  settles the USDC on chain, then provisions the GPU on Nosana credits.
</p>

<p align="center">Built as a working proposal for native x402 support in Nosana.</p>

<p align="center">
  <img src="https://img.shields.io/badge/protocol-x402%20v2-9945FF" alt="protocol x402 v2">
  <img src="https://img.shields.io/badge/payments-USDC%20on%20Solana-2775CA" alt="payments USDC on Solana">
  <img src="https://img.shields.io/badge/compute-Nosana%20credits%20API-10b981" alt="compute Nosana credits API">
  <img src="https://img.shields.io/badge/runtime-Bun%20%2B%20Hono-0f172a" alt="runtime Bun and Hono">
  <img src="https://img.shields.io/badge/tests-89%20passing-1f8a5b" alt="89 tests passing">
  <img src="https://img.shields.io/badge/license-MIT-555555" alt="license MIT">
</p>

<p align="center">
  <img src="docs/assets/flow.svg" width="840" alt="An AI agent pays USDC over HTTP; the gateway verifies and settles the payment through the PayAI facilitator on Solana, then provisions a Nosana GPU job on credits.">
</p>

The whole loop, run end to end against Nosana mainnet with the mock agent in
[scripts/agent-demo.ts](scripts/agent-demo.ts):

```console
$ bun run scripts/agent-demo.ts        # AGENT_X402_NETWORK=solana, market nvidia-3060
PASS    discover markets       46 markets, using "nvidia-3060"
PASS    rent (pay 402)         deployment=9H4bVD1v... paid=0.003634 USD tx=3dkKwc4B...
PASS    poll until running     RUNNING
BLOCKED hit deployment endpoint credits-rail job exposes no service URL
PASS    extend (pay 402)       new timeout=10 minutes tx=3hGVh8sc...
PASS    stop                   final status=COMPLETED
```

An agent that holds only USDC and speaks plain HTTP paid for a GPU, ran a job,
paid again to extend it, and stopped it. Transaction links are in
[Live on Solana mainnet](#live-on-solana-mainnet).

## The problem

An AI agent that needs a GPU today has two doors into Nosana, and both need a
human. The on-chain door requires the agent to hold NOS plus SOL and to speak
the Solana SDK. The hosted door requires a person to register an account, buy
credits with a card, and hand the agent an API key. Either way, someone
provisions identity and funding before the first job runs.

Meanwhile agent treasuries hold USDC and speak plain HTTP. The x402 protocol
closes exactly that gap: a server quotes a price inside an HTTP 402 response,
the client pays on chain, and the same request retries with proof of payment.
Nosana has no x402 surface today; this gateway is that surface, built on
Nosana's public SDK with zero changes to their stack.

## What it does

- **One paid endpoint.** `POST /rent` speaks x402 v2: without a
  `PAYMENT-SIGNATURE` header it answers 402 with `PaymentRequirements` and a
  `PAYMENT-REQUIRED` header; with one it verifies, settles, provisions, and
  returns the job. See [src/routes/rent.ts](src/routes/rent.ts).
- **Server-side pricing.** The quote is `usd_reward_per_hour` from Nosana's live
  markets API, prorated per minute in integer micro-USD (BigInt ceiling
  division, one rounding step, no floating point on money). Client-supplied
  prices do not exist. See [src/lib/pricing.ts](src/lib/pricing.ts).
- **Availability before payment.** The 402 and `GET /markets` carry a live
  `availability` block read from each market's on-chain queue, so an agent
  learns whether a host is idle now or it will wait, before it pays. An opt-in
  `require_available` flag makes the gateway refuse to charge for a queued
  market. See [src/lib/availability.ts](src/lib/availability.ts).
- **Settle before provision.** The facilitator settles the USDC transfer before
  the job is posted, because a GPU handout is irreversible and verify alone does
  not prove on-chain finality. See [src/lib/paymentFlow.ts](src/lib/paymentFlow.ts).
- **Credits-rail provisioning.** The job definition is pinned to IPFS, then
  posted with `jobs.list` on Nosana's credits API (the endpoint that accepts a
  `Bearer nos_` key); the gateway's credits pay the host. See
  [src/lib/provisioning.ts](src/lib/provisioning.ts).
- **Replay protection.** A SQLite ledger keyed by the SHA-256 of the payment
  header, with a UNIQUE constraint on the settled transaction signature; the
  reservation insert is the atomic check-and-set. See
  [src/lib/settlementStore.ts](src/lib/settlementStore.ts).
- **Refund ledger.** A payment that settles but fails to provision is recorded
  as `provision_failed`; the startup scan prints every refund owed with its
  transaction signature.
- **Scoped sessions.** Each rental returns an HS256 JWT bound to one
  `deployment_id`. Lifecycle routes reject a session presented against any other
  job. See [src/lib/session.ts](src/lib/session.ts).

## How it works

```mermaid
sequenceDiagram
    participant Agent as AI agent
    participant GW as nosana-x402-gateway
    participant Fac as PayAI facilitator
    participant Nos as Nosana credits API

    Agent->>GW: POST /rent (market, minutes, job definition)
    GW->>Nos: read live market rate and on-chain queue
    GW-->>Agent: 402 PaymentRequirements (amount, payTo, availability)
    Agent->>Agent: sign USDC TransferChecked (partially signed)
    Agent->>GW: POST /rent with PAYMENT-SIGNATURE header
    GW->>Fac: verify payment
    Fac-->>GW: isValid
    GW->>GW: reserve payment key (anti-replay)
    GW->>Fac: settle (USDC moves on Solana)
    Fac-->>GW: transaction signature
    GW->>Nos: pin to IPFS, then jobs.list (charge credits)
    Nos-->>GW: job address (QUEUED, a host picks it up)
    GW-->>Agent: 200 (deployment id, session JWT, tx signature)
```

The unhappy paths are where the design lives. A garbage or invalid payment is
refused at verify, before any settle, with 402 and no money moved:

```console
$ curl -s -w "\nHTTP %{http_code}\n" -X POST localhost:3000/rent \
    -H "PAYMENT-SIGNATURE: bm90LWEtcmVhbC1wYXltZW50" \
    -H "content-type: application/json" \
    -d '{"market":"nvidia-3060","duration_minutes":60,"job_definition":{...}}'
{"error":"payment verification failed: unexpected_verify_error"}
HTTP 402
```

A settle that succeeds but a provision that fails marks the payment
`provision_failed` and returns the transaction signature to the agent; the
startup scan lists every such record as a refund owed. A facilitator transport
failure returns 502, distinct from a payment rejection, which returns 402. A
replayed payment header, or a second header carrying an already-settled
transaction, stops at 409 before any fulfillment. A gateway with no Nosana API
key refuses every payment with 503 before verification, so money never moves
toward capacity that does not exist.

### API surface

| Route | Auth | Success | Distinct failures |
| --- | --- | --- | --- |
| `POST /rent` | x402 payment | 200 deployment, session, tx | 400 bad input, 402 payment, 404 unknown market, 409 replay, 502 upstream, 503 capacity |
| `GET /rent/:id` | session JWT | 200 status, timeout | 401 session, 502 lookup |
| `POST /rent/:id/extend` | session JWT + x402 payment | 200 new timeout, refreshed session | same as `POST /rent` plus 401 |
| `POST /rent/:id/stop` | session JWT | 200 stopped | 401 session, 502 upstream |
| `GET /markets` | none | 200 tiers with live rates and availability | 502 upstream |
| `GET /health` | none | 200 | none |

## How it integrates with Nosana

The gateway sits between two rails it does not own: Solana for the payment,
Nosana's public SDK for the compute. It changes nothing in Nosana's stack.

```mermaid
flowchart LR
    agent["AI agent, USDC wallet, plain HTTP"]

    subgraph gw["nosana-x402-gateway"]
        direction TB
        price["price the job from the live market rate"]
        pay["verify and settle the USDC"]
        prov["provision the job on credits"]
    end

    subgraph solana["Solana, the payment rail"]
        fac["PayAI facilitator, gasless, moves USDC to the treasury"]
    end

    subgraph nosana["Nosana, the compute rail, unchanged public SDK"]
        mk["markets API, live rate and on-chain queue depth"]
        cr["credits ledger, client-manager, Bearer nos_ key"]
        gpu["a GPU host runs the container"]
    end

    agent -->|"POST /rent"| price
    price -. reads .-> mk
    agent -->|"PAYMENT-SIGNATURE"| pay
    pay --> fac
    pay --> prov
    prov -->|"IPFS pin and jobs.list"| cr --> gpu
```

Nosana exposes two ways to run compute. The on-chain jobs program is
permissionless but wants NOS and a signing wallet. The credits API is
USD-denominated and takes a `Bearer nos_` key, and its `jobs.list` endpoint is
the one that actually accepts that key for posting a job. This gateway uses the
credits rail: the operator's credits pay the host, and the agent pays the
operator in USDC through x402. Settling those USDC payments straight into
Nosana's own credit ledger, so no operator sits in the middle, is the upstream
goal and the reason this is framed as a proposal.

## Live on Solana mainnet

The full rent, run, extend, stop loop, executed end to end against Nosana
mainnet on 2026-07-06:

| Step | Result | Proof |
| --- | --- | --- |
| Rent, pay 402 | 0.003634 USDC settled | tx [3dkKwc4B](https://solscan.io/tx/3dkKwc4BtirCXgoerhpHeLejTg7SHQQPCCXpHhzF6qkjkndia3MDhezPkckqG5RHjspQWfeSascUywSfXCHj7K1s) |
| Provision on credits | job posted, reached RUNNING | job [9H4bVD1v](https://solscan.io/account/9H4bVD1vNRzAj2J7EVPajEcopMV46b4WUHyVR1YpV2Pj) |
| Extend, second payment | timeout 5 to 10 minutes | tx [3hGVh8sc](https://solscan.io/tx/3hGVh8scMP5JXdKqrhXXhWTrQRUKJqupkPMszRZxyBGRHn2xnkVweV5o8TtCAiRxgdu6RQAbRYZ1nQmXdGnY46Jk) |
| Stop | final status COMPLETED | run log above |

Discovery is live too: `GET /markets` on mainnet returns 47 tiers, each with the
real queue read from chain. At capture time `nvidia-5070` had 25 idle hosts
(a paid job starts at once) while `nvidia-4070` had 297 jobs queued (a paid job
would wait), which is exactly the difference the `availability` block exists to
tell the agent before it pays.

The strongest evidence is a negative one. Payment
[66rz5eLo](https://solscan.io/tx/66rz5eLoQb1viiX1t8LHKcRyRGqZYb6nfyMuAvi3U92L6AfNRskYMcLS7M35XRxEhBUMtmmk5p6soxALpGt7Ehg6)
settled on chain but its provision failed; the gateway did not pretend it
succeeded. It returned 502 with the signature and recorded a refund owed, which
the startup scan reprints on every boot. A system that can correctly say "you
paid and I could not deliver" is the one you can trust with the happy path.

## Reproduce it

Prerequisites: [Bun](https://bun.sh) 1.3 or later (built and tested on 1.3.14).
No Nosana account is needed for quote-only mode.

```bash
git clone https://github.com/Andy00L/nosana-x402-gateway
cd nosana-x402-gateway
bun install
cp .env.example .env
# In .env set TREASURY_WALLET_ADDRESS to a base58 pubkey you control,
# JWT_SECRET to the output of: openssl rand -hex 32,
# and NOSANA_X402_NETWORK=mainnet to browse real markets (quote-only,
# no funds move without a payment).
bun run dev
```

Then, in another terminal:

```bash
curl -s localhost:3000/markets
curl -s -w "\nHTTP %{http_code}\n" -X POST localhost:3000/rent \
  -H "content-type: application/json" \
  -d '{"market":"nvidia-3060","duration_minutes":60,"job_definition":{"version":"0.1","type":"container","ops":[{"type":"container/run","id":"demo","args":{"image":"nginx"}}]}}'
```

Success looks like: the first call returns the live market list with an
`availability` field per tier, the second returns `HTTP 402` with a body
starting `{"x402Version":2` and an `amount` matching the market's hourly rate.
`bun run typecheck` exits 0 on a clean clone, and `bun test` runs 89 unit tests
across pricing, availability, sessions, the settlement store, the payment
gauntlet, timeouts, the x402 header, markets, admin, and config. Every command
here was executed against this revision.

## What is real and what is not

- **The money-moving loop is signed off on mainnet.** Rent, run, extend, and
  stop all ran with real USDC and real credits (transactions above). What
  remains are the items below, stated plainly.
- **The credits rail exposes no live service URL.** For a compute job, results
  come back by job id through IPFS. For a service job that exposes a port (the
  nginx demo), Nosana's credits API returns no reachable URL the way the
  deployment manager did, so the demo marks that one step blocked, not passed.
  Surfacing service URLs on the credits rail is an open question for the Nosana
  team.
- **Refunds are recorded, not sent.** The ledger and the startup scan name every
  refund owed with its transaction signature; automated refunds need the
  treasury hot wallet and are gated behind a security review. One refund of
  0.000727 USDC from a pre-fix provision failure is currently outstanding.
- **The renter fee question is open.** Markets expose a `network_fee_percentage`
  (10 today). Whether the renter pays it on top of `usd_reward_per_hour` is
  unconfirmed; the gateway charges the base rate. Asked to the Nosana team;
  reconciliation depends on the answer.
- **Quote-only mode oversells.** Without `NOSANA_API_KEY` the gateway serves
  quotes it cannot fulfill, for local development; every payment against it is
  refused with 503 before money moves.
- **No rate limiting yet.** The paid path is naturally metered by payment, but
  the quote path can be spammed into Nosana's markets API (60s cache aside).
- **The trust model is custodial for v1.** The operator's wallet receives the
  USDC and the operator's Nosana credits pay for the compute. Settling x402
  payments straight into Nosana's credit ledger is the upstream goal and needs
  their backend.

## Repository layout

```
src/
  index.ts       entry point: config, wiring, on-chain availability adapter, refund scan
  config.ts      environment validation, crash early on bad config
  lib/           pricing, markets, availability, x402 wrappers, payment gauntlet,
                 settlement store, sessions, credits provisioning, timeouts
  routes/        rent (quote, pay, lifecycle), markets discovery, admin ledger
  *.test.ts      unit tests colocated with the modules they cover
scripts/         agent-demo.ts, the mock x402 agent for the mainnet sign-off
docs/assets/     the icon and the flow diagram
.env.example     every environment variable, documented
```

## License

MIT. See [LICENSE](LICENSE).
