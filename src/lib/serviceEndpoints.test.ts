import { describe, expect, test } from "bun:test";
import { NosanaNetwork, type JobDefinition } from "@nosana/kit";
import {
  deriveServiceEndpoints,
  deriveServiceEndpointsFromRecord,
} from "./serviceEndpoints.js";

// The sign-off job definition (nginx serving port 80), the same one the
// mainnet agent demo posts.
const NGINX_JOB_DEFINITION: JobDefinition = {
  version: "0.1",
  type: "container",
  ops: [
    {
      type: "container/run",
      id: "web",
      args: { image: "nginx", expose: 80 },
    },
  ],
};

// Live fixture, verified 2026-07-08: this credits-rail job was posted with the
// nginx definition above and the derived URL answered HTTP 200 (nginx welcome
// page) while the job was RUNNING on mainnet.
const VERIFIED_JOB_ADDRESS = "DZDySeNqJHorzSkNCSwtWWyzbUFj7fdnRhDoHfsjTbGC";
const VERIFIED_SERVICE_URL =
  "https://2r6QubXVuSYX16Nq9Fu5bSjcE5JVicno7KUSBZa1Ewxd.node.k8s.prd.nos.ci";

describe("deriveServiceEndpoints", () => {
  test("reproduces the live-verified mainnet service URL for the nginx job", () => {
    const endpoints = deriveServiceEndpoints(
      NGINX_JOB_DEFINITION,
      VERIFIED_JOB_ADDRESS,
      NosanaNetwork.MAINNET,
    );
    expect(endpoints).toEqual([{ opId: "web", port: 80, url: VERIFIED_SERVICE_URL }]);
  });

  test("derives one endpoint per exposed port across ops", () => {
    const multiPortDefinition: JobDefinition = {
      version: "0.1",
      type: "container",
      ops: [
        {
          type: "container/run",
          id: "api",
          args: { image: "nginx", expose: [80, 8080] },
        },
        {
          type: "container/run",
          id: "worker",
          args: { image: "busybox" },
        },
      ],
    };
    const endpoints = deriveServiceEndpoints(
      multiPortDefinition,
      VERIFIED_JOB_ADDRESS,
      NosanaNetwork.MAINNET,
    );
    expect(endpoints.length).toBe(2);
    expect(endpoints.map((endpoint) => endpoint.port)).toEqual([80, 8080]);
    // Distinct ports must never collide on one URL.
    expect(new Set(endpoints.map((endpoint) => endpoint.url)).size).toBe(2);
    for (const endpoint of endpoints) {
      expect(endpoint.opId).toBe("api");
      expect(endpoint.url).toMatch(/^https:\/\/[1-9A-HJ-NP-Za-km-z]+\.node\.k8s\.prd\.nos\.ci$/);
    }
  });

  test("returns no endpoints when nothing is exposed", () => {
    const noExposeDefinition: JobDefinition = {
      version: "0.1",
      type: "container",
      ops: [
        { type: "container/run", id: "batch", args: { image: "busybox" } },
      ],
    };
    expect(
      deriveServiceEndpoints(noExposeDefinition, VERIFIED_JOB_ADDRESS, NosanaNetwork.MAINNET),
    ).toEqual([]);
  });

  test("returns no endpoints for a private job instead of a dead link", () => {
    const privateDefinition: JobDefinition = {
      version: "0.1",
      type: "container",
      ops: [
        {
          type: "container/run",
          id: "web",
          args: { image: "nginx", expose: 80, private: true },
        },
      ],
    };
    expect(
      deriveServiceEndpoints(privateDefinition, VERIFIED_JOB_ADDRESS, NosanaNetwork.MAINNET),
    ).toEqual([]);
  });

  test("returns no endpoints on localnet or for a blank job address", () => {
    expect(
      deriveServiceEndpoints(NGINX_JOB_DEFINITION, VERIFIED_JOB_ADDRESS, NosanaNetwork.LOCALNET),
    ).toEqual([]);
    expect(
      deriveServiceEndpoints(NGINX_JOB_DEFINITION, "", NosanaNetwork.MAINNET),
    ).toEqual([]);
  });
});

describe("deriveServiceEndpointsFromRecord", () => {
  test("derives endpoints from a valid untyped job record definition", () => {
    const endpoints = deriveServiceEndpointsFromRecord(
      JSON.parse(JSON.stringify(NGINX_JOB_DEFINITION)),
      VERIFIED_JOB_ADDRESS,
      NosanaNetwork.MAINNET,
    );
    expect(endpoints).toEqual([{ opId: "web", port: 80, url: VERIFIED_SERVICE_URL }]);
  });

  test("yields no endpoints for a malformed or missing definition", () => {
    expect(
      deriveServiceEndpointsFromRecord(undefined, VERIFIED_JOB_ADDRESS, NosanaNetwork.MAINNET),
    ).toEqual([]);
    expect(
      deriveServiceEndpointsFromRecord(
        { version: "0.1" },
        VERIFIED_JOB_ADDRESS,
        NosanaNetwork.MAINNET,
      ),
    ).toEqual([]);
  });
});
