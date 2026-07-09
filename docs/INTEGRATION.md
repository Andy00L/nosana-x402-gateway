# Integration spec: native x402 on Nosana

For the Nosana team. What the gateway proves, exactly where it touches Nosana
today, the three ways to adopt it, and the two confirmations only Nosana can
give. Everything here is verifiable against the code in this repository and the
mainnet transactions in the [README](../README.md#live-on-solana-mainnet).

## What is proven

An AI agent holding only USDC, speaking only HTTP, rented Nosana GPU compute on
mainnet with zero changes to Nosana's stack: rent (402 paid, tx `4nVCqPSq`),
reach RUNNING, HTTP 200 from the job's service URL, extend (second payment, tx
`2BJmQebi`), stop. Raw transcript:
[evidence/2026-07-08-mainnet-signoff.txt](evidence/2026-07-08-mainnet-signoff.txt).
The failure paths are equally exercised: replayed payments stop at 409, a
settled payment whose provision fails is recorded as a refund owed with its tx
(one such case on chain: tx `66rz5eLo`).

## Where the gateway touches Nosana today

Four read or call surfaces, all public or API-key based, none modified:

| Touchpoint | Call | Used for |
| --- | --- | --- |
| Markets API | `GET /api/markets` (kit `api.markets.list`) | live `usd_reward_per_hour` pricing |
| On-chain markets | `client.jobs.markets()` (keyless RPC) | queue depth: idle hosts vs waiting jobs, disclosed before payment |
| Credits API | `api.jobs.list / get / extend / stop` with a `nos_` key | provisioning and lifecycle; `ipfs.pin` first for the job definition |
| Expose hash | `getJobExposedServices` from `@nosana/kit` | deriving each exposed port's `https://<hash>.node.k8s.prd.nos.ci` URL |

Everything else (x402 handshake, settle-before-provision ordering, replay
ledger, refund records, session JWTs, availability disclosure) lives in the
gateway and moves with it.

## Three adoption paths

1. **Third party operates it (works today).** An operator runs the gateway
   with their own treasury wallet and credits account. Custodial: the operator
   holds the USDC and fronts the credits. No Nosana work required. This is the
   deployed state of this repository.
2. **Nosana operates it (works today, small step).** Same code, run by Nosana,
   payTo is a Nosana treasury and the credits account is internal. Custody
   collapses into Nosana; agents get an official x402 endpoint. Work: hosting
   plus key management, nothing in client-manager changes.
3. **Native (the endgame).** client-manager answers unpaid job posts with the
   402 (price from the same market rate it already charges), verifies and
   settles through a facilitator, and books the settled USDC straight into the
   credits ledger it already owns. No middleman balance at all. The gateway is
   then the reference implementation and its client contract (`GET /`, the 402
   `hint` and `availability` blocks, the receipt shape) is already
   agent-tested. Work: one paid route plus a ledger credit entry; the x402
   verify and settle calls are two HTTP requests to a facilitator.

## The two confirmations only Nosana can give

1. **Renter fee semantics.** Measured on 2026-07-08: on-chain job accounts
   price at 1.1x the base rate (`job_price_per_second` over
   `reward_per_second` is 1.1 on all 16 markets checked, matching
   `network_fee_percentage` of 10), yet the credits ledger reserved exactly
   the base rate for this gateway's test job. Which is intended for a
   credits-rail renter? The gateway charges base until answered (ticket 1744).
2. **Is the expose-hash derivation a contract?** The credits API returns no
   endpoint field, so the gateway derives service URLs with the same
   `getExposeIdHash(opIndex, port, jobAddress)` that nosana-cli uses,
   verified working on mainnet. If Nosana confirms the derivation and the
   `node.k8s.prd.nos.ci` ingress as stable, this is settled; the cleaner fix
   is returning endpoints from the jobs API itself.

Two smaller asks, non-blocking: dashboard-issued keys that authorize against
the devnet client-manager (devnet testing currently requires mainnet), and a
documented way to fetch job results by job id over plain HTTP so the loop needs
no SDK anywhere.

## What was deliberately left out

Automated refunds (records only: paying out from a hot wallet deserves its own
security review), rate limiting on the unpaid quote path, and any multi-token
support beyond USDC. Each is listed honestly in the README's
[What is real and what is not](../README.md#what-is-real-and-what-is-not).

## Contact

Repository: https://github.com/Andy00L/nosana-x402-gateway. Nosana account
used for the mainnet proof: 0therealandy0@gmail.com. Happy to demo the loop
live to the team.
