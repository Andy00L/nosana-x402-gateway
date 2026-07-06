import { describe, expect, test } from "bun:test";
import {
  deriveAvailability,
  shouldRefuseUnavailable,
  formatAvailability,
  createAvailabilityService,
  type MarketAvailability,
  type MarketQueueSnapshot,
  type MarketQueueSource,
} from "./availability.js";
import { ok, err, type Result } from "./result.js";

// Queue-type values verified live on 2026-07-06: NODE=1, JOB=0, Empty=255
// (sourceRef: @nosana/kit MarketQueueType and the probe in the build notes).
const NODE_QUEUE = 1;
const JOB_QUEUE = 0;
const EMPTY_QUEUE = 255;

describe("deriveAvailability", () => {
  test("a node queue with idle hosts is available now", () => {
    const availability = deriveAvailability(NODE_QUEUE, 3);
    expect(availability.status).toBe("nodes_available");
    expect(availability.nodesAvailable).toBe(3);
    expect(availability.jobsQueued).toBe(0);
  });

  test("a node queue with no hosts is not available", () => {
    const availability = deriveAvailability(NODE_QUEUE, 0);
    expect(availability.status).toBe("no_nodes_available");
    expect(availability.nodesAvailable).toBe(0);
  });

  test("a job queue with waiting jobs reports the queue depth", () => {
    const availability = deriveAvailability(JOB_QUEUE, 2);
    expect(availability.status).toBe("queued");
    expect(availability.jobsQueued).toBe(2);
    expect(availability.nodesAvailable).toBe(0);
  });

  test("a job queue with nothing waiting means no host is ready", () => {
    const availability = deriveAvailability(JOB_QUEUE, 0);
    expect(availability.status).toBe("no_nodes_available");
  });

  test("the empty sentinel (255) is treated as no host available", () => {
    const availability = deriveAvailability(EMPTY_QUEUE, 0);
    expect(availability.status).toBe("no_nodes_available");
    expect(availability.nodesAvailable).toBe(0);
    expect(availability.jobsQueued).toBe(0);
  });

  test("an unexpected queue type with entries never claims availability", () => {
    // Robustness: only a NODE queue means idle hosts. Anything else stays safe.
    const availability = deriveAvailability(EMPTY_QUEUE, 5);
    expect(availability.status).toBe("no_nodes_available");
    expect(availability.nodesAvailable).toBe(0);
  });

  test("a negative length is clamped to zero", () => {
    const availability = deriveAvailability(NODE_QUEUE, -1);
    expect(availability.nodesAvailable).toBe(0);
    expect(availability.status).toBe("no_nodes_available");
  });
});

const availableNow = (): Result<MarketAvailability> =>
  ok({ status: "nodes_available", nodesAvailable: 2, jobsQueued: 0 });
const queued = (): Result<MarketAvailability> =>
  ok({ status: "queued", nodesAvailable: 0, jobsQueued: 4 });

describe("shouldRefuseUnavailable", () => {
  test("never refuses when the flag is off", () => {
    expect(shouldRefuseUnavailable(false, queued())).toBe(false);
    expect(shouldRefuseUnavailable(false, err("unreadable"))).toBe(false);
  });

  test("allows a paid rental when a host is available", () => {
    expect(shouldRefuseUnavailable(true, availableNow())).toBe(false);
  });

  test("refuses when the market is queued", () => {
    expect(shouldRefuseUnavailable(true, queued())).toBe(true);
  });

  test("fails closed when availability cannot be read", () => {
    expect(shouldRefuseUnavailable(true, err("rpc down"))).toBe(true);
  });
});

describe("formatAvailability", () => {
  test("renders an available market with an immediate-start note", () => {
    const view = formatAvailability(availableNow());
    expect(view.status).toBe("nodes_available");
    expect(view.nodes_available).toBe(2);
    expect(view.note).toContain("immediately");
  });

  test("renders a queued market with the depth in the note", () => {
    const view = formatAvailability(queued());
    expect(view.status).toBe("queued");
    expect(view.jobs_queued).toBe(4);
    expect(view.note).toContain("queued ahead");
  });

  test("renders an unreadable queue as unknown", () => {
    const view = formatAvailability(err("rpc down"));
    expect(view.status).toBe("unknown");
    expect(view.note).toContain("unknown");
  });
});

const ADDRESS_WITH_HOSTS = "9MGKqixvtLJgL46Bp38ZrD3MxTMRt57VL3rQtQY64zj4";
const ADDRESS_WITH_JOBS = "5XiAbifHtRQt3w1JSBGtMtoFmVMX23vdVciJpA2vyFp2";

const buildStubQueueSource = (
  readImplementation: () => Promise<Result<MarketQueueSnapshot[]>>,
): { source: MarketQueueSource; callCount: () => number } => {
  let calls = 0;
  return {
    source: {
      readAllMarketQueues: () => {
        calls += 1;
        return readImplementation();
      },
    },
    callCount: () => calls,
  };
};

describe("createAvailabilityService", () => {
  test("maps every market to its derived availability", async () => {
    const { source } = buildStubQueueSource(async () =>
      ok([
        { address: ADDRESS_WITH_HOSTS, queueType: NODE_QUEUE, queueLength: 2 },
        { address: ADDRESS_WITH_JOBS, queueType: JOB_QUEUE, queueLength: 3 },
      ]),
    );
    const service = createAvailabilityService(source);
    const all = await service.listAvailability();
    expect(all.ok).toBe(true);
    if (all.ok) {
      expect(all.value.get(ADDRESS_WITH_HOSTS)?.status).toBe("nodes_available");
      expect(all.value.get(ADDRESS_WITH_JOBS)?.status).toBe("queued");
    }
  });

  test("returns one market by address", async () => {
    const { source } = buildStubQueueSource(async () =>
      ok([{ address: ADDRESS_WITH_HOSTS, queueType: NODE_QUEUE, queueLength: 1 }]),
    );
    const service = createAvailabilityService(source);
    const one = await service.getMarketAvailability(ADDRESS_WITH_HOSTS);
    expect(one.ok).toBe(true);
    if (one.ok) {
      expect(one.value.nodesAvailable).toBe(1);
    }
  });

  test("reports an unknown market address as an error", async () => {
    const { source } = buildStubQueueSource(async () =>
      ok([{ address: ADDRESS_WITH_HOSTS, queueType: NODE_QUEUE, queueLength: 1 }]),
    );
    const service = createAvailabilityService(source);
    const missing = await service.getMarketAvailability("not-a-listed-market");
    expect(missing.ok).toBe(false);
  });

  test("serves a second call from cache inside the TTL", async () => {
    const { source, callCount } = buildStubQueueSource(async () =>
      ok([{ address: ADDRESS_WITH_HOSTS, queueType: NODE_QUEUE, queueLength: 1 }]),
    );
    const service = createAvailabilityService(source);
    await service.listAvailability();
    await service.getMarketAvailability(ADDRESS_WITH_HOSTS);
    expect(callCount()).toBe(1);
  });

  test("does not cache a failed read and retries on the next call", async () => {
    let attempt = 0;
    const { source, callCount } = buildStubQueueSource(async () => {
      attempt += 1;
      return attempt === 1
        ? err("rpc down")
        : ok([{ address: ADDRESS_WITH_HOSTS, queueType: NODE_QUEUE, queueLength: 1 }]);
    });
    const service = createAvailabilityService(source);
    const first = await service.listAvailability();
    expect(first.ok).toBe(false);
    const second = await service.listAvailability();
    expect(second.ok).toBe(true);
    expect(callCount()).toBe(2);
  });
});
