import { MarketQueueType } from "@nosana/kit";
import { type Result, ok, err } from "./result.js";

// GPU availability for a Nosana market, derived from the market's on-chain
// queue. A Nosana market holds ONE shared queue that is either a node queue
// (idle hosts waiting for work) or a job queue (jobs waiting for a host); a job
// and an idle host match immediately, so the two never coexist.
//   sourceRef: @nosana/jobs-program accounts/marketAccount.d.ts
//     (`queue: Array<Address>`, `queueType: number`) and
//     types/queueType.d.ts (`QueueType { Job, Node, Empty }`).
//   The kit's MarketQueueType names only JOB_QUEUE=0 and NODE_QUEUE=1.
//   Verified live on 2026-07-06 (devnet): a market with waiting jobs reads
//   queueType=0 with queue.length jobs; an idle/empty market reads queueType=255
//   (the Empty sentinel) with an empty queue. The API markets record does NOT
//   carry this (its `nodes` array is always empty), so the on-chain queue is the
//   only real availability signal.
export type AvailabilityStatus =
  // At least one idle host is waiting: a paid job starts right away.
  | "nodes_available"
  // Jobs are already queued ahead: a paid job waits behind them for a host.
  | "queued"
  // No idle host and no queue: a paid job waits for the next host to appear.
  | "no_nodes_available";

export interface MarketAvailability {
  readonly status: AvailabilityStatus;
  // Idle GPU hosts ready to take a job immediately.
  readonly nodesAvailable: number;
  // Jobs already waiting ahead of a new submission.
  readonly jobsQueued: number;
}

// One market's on-chain queue snapshot, in plain domain terms. The kit's
// branded Address/enum types are adapted to this at the composition edge
// (src/index.ts) so this module and its tests stay free of Solana types.
export interface MarketQueueSnapshot {
  readonly address: string;
  readonly queueType: number;
  readonly queueLength: number;
}

// The on-chain reader the availability service depends on. Reads every market
// in one call (client.jobs.markets() takes no arguments), which is also the
// cheap path for the discovery endpoint. Returns a Result so a transient RPC
// failure is a value, not a throw (SKILL_GENERAL.md section 5).
export interface MarketQueueSource {
  readAllMarketQueues: () => Promise<Result<MarketQueueSnapshot[]>>;
}

// Availability refresh window. Queues move faster than prices (a host can grab
// a job within seconds), so this is short. In-memory, lost on restart, which is
// fine for a cache.
const AVAILABILITY_CACHE_TTL_MS = 10_000;

// Pure mapping from a raw queue snapshot to availability. Only a NODE queue with
// entries means idle hosts are ready now; every other state (job queue, or the
// Empty sentinel) means a new job would wait, so it never over-claims capacity.
export const deriveAvailability = (
  queueType: number,
  queueLength: number,
): MarketAvailability => {
  const safeLength = queueLength > 0 ? queueLength : 0;
  if (queueType === MarketQueueType.NODE_QUEUE) {
    return {
      status: safeLength > 0 ? "nodes_available" : "no_nodes_available",
      nodesAvailable: safeLength,
      jobsQueued: 0,
    };
  }
  if (queueType === MarketQueueType.JOB_QUEUE && safeLength > 0) {
    return { status: "queued", nodesAvailable: 0, jobsQueued: safeLength };
  }
  return { status: "no_nodes_available", nodesAvailable: 0, jobsQueued: 0 };
};

// Gate decision for the opt-in require_available flag. Fails closed: if the
// agent demands an immediately-available host and one cannot be confirmed
// (queue unreadable, or the market is not in the node-available state), refuse
// before any money moves. Pure, so the refusal rule is unit-tested without the
// rent router.
export const shouldRefuseUnavailable = (
  requireAvailable: boolean,
  availability: Result<MarketAvailability>,
): boolean => {
  if (!requireAvailable) {
    return false;
  }
  if (!availability.ok) {
    return true;
  }
  return availability.value.status !== "nodes_available";
};

// Wire-shape availability block for HTTP responses, snake_case to match the
// rest of the gateway JSON (usd_per_hour, duration_minutes, tx_signature). An
// unreadable queue is reported honestly as "unknown" rather than guessed.
export interface AvailabilityView {
  readonly status: AvailabilityStatus | "unknown";
  readonly nodes_available: number;
  readonly jobs_queued: number;
  readonly note: string;
}

const noteForAvailability = (availability: MarketAvailability): string => {
  switch (availability.status) {
    case "nodes_available":
      return `${availability.nodesAvailable} GPU host(s) idle now; a paid job starts immediately`;
    case "queued":
      return `no idle host; ${availability.jobsQueued} job(s) queued ahead, a paid job waits for a host`;
    case "no_nodes_available":
      return "no idle host right now; a paid job waits for the next host to come online";
  }
};

export const formatAvailability = (availability: Result<MarketAvailability>): AvailabilityView => {
  if (!availability.ok) {
    return {
      status: "unknown",
      nodes_available: 0,
      jobs_queued: 0,
      note: "market queue could not be read right now; availability is unknown",
    };
  }
  return {
    status: availability.value.status,
    nodes_available: availability.value.nodesAvailable,
    jobs_queued: availability.value.jobsQueued,
    note: noteForAvailability(availability.value),
  };
};

// Pick one market's availability out of a bulk read, as a Result the response
// formatter accepts. Keeps route code free of map and null handling.
export const selectAvailability = (
  allAvailability: Result<Map<string, MarketAvailability>>,
  address: string,
): Result<MarketAvailability> => {
  if (!allAvailability.ok) {
    return err(allAvailability.reason);
  }
  const marketAvailability = allAvailability.value.get(address);
  if (!marketAvailability) {
    return err(`market ${address} was not found in the on-chain market set`);
  }
  return ok(marketAvailability);
};

export interface AvailabilityService {
  // Availability for every market, keyed by market address. Best-effort: a
  // failed on-chain read is an err, callers degrade to "unknown".
  listAvailability: () => Promise<Result<Map<string, MarketAvailability>>>;
  // Availability for one market by address, served from the same cached read.
  getMarketAvailability: (address: string) => Promise<Result<MarketAvailability>>;
}

export const createAvailabilityService = (
  queueSource: MarketQueueSource,
): AvailabilityService => {
  let availabilityCache: { fetchedAtMs: number; byAddress: Map<string, MarketAvailability> } | null =
    null;

  const listAvailability: AvailabilityService["listAvailability"] = async () => {
    const nowMs = Date.now();
    if (availabilityCache && nowMs - availabilityCache.fetchedAtMs < AVAILABILITY_CACHE_TTL_MS) {
      return ok(availabilityCache.byAddress);
    }
    const snapshots = await queueSource.readAllMarketQueues();
    if (!snapshots.ok) {
      // Do not cache a failure: the next request retries the read.
      return snapshots;
    }
    const byAddress = new Map<string, MarketAvailability>();
    for (const snapshot of snapshots.value) {
      byAddress.set(
        snapshot.address,
        deriveAvailability(snapshot.queueType, snapshot.queueLength),
      );
    }
    availabilityCache = { fetchedAtMs: nowMs, byAddress };
    return ok(byAddress);
  };

  const getMarketAvailability: AvailabilityService["getMarketAvailability"] = async (address) =>
    selectAvailability(await listAvailability(), address);

  return { listAvailability, getMarketAvailability };
};
