import { createNosanaClient, isNosanaApiError, type JobDefinition } from "@nosana/kit";
import { type Result, ok, err } from "./result.js";
import { withTimeout as withTimeoutForCall } from "./withTimeout.js";
import {
  deriveServiceEndpoints,
  deriveServiceEndpointsFromRecord,
  type ServiceEndpoint,
} from "./serviceEndpoints.js";
import type { GatewayConfig } from "../config.js";
import type { RentQuote } from "./pricing.js";

// USDC has 6 decimals, so 1 USD cent = 10^4 atomic units. The Nosana credits
// balance is denominated in USD DOLLARS (float), NOT cents: the API schema
// comment says "USD cents" but the live dashboard proves dollars (assigned
// 58 minus settled 7.869 = 50.13, shown as $50.13; verified 2026-07-05).
const USDC_ATOMIC_PER_CENT = 10_000n;

// The gateway's spendable credits, in USD dollars, as read from Nosana.
// availableUsd is what remains after reservations and settled spend.
export interface CreditsBalance {
  readonly assignedUsd: number;
  readonly reservedUsd: number;
  readonly settledUsd: number;
  readonly availableUsd: number;
}

// Coverage decision, extracted as a pure function so it is unit-testable
// without a network client. Refuses when settling this rental would drop the
// balance below the configured floor. The dollar balance is converted to
// integer atomic units once (floored to whole cents, the conservative
// direction, since floats cannot be trusted for settlement math); every
// comparison after that is integer BigInt.
export const evaluateCreditsCoverage = (params: {
  availableUsd: number;
  quoteAmountAtomic: string;
  floorCents: number;
}): Result<void> => {
  const availableCents = params.availableUsd > 0 ? Math.floor(params.availableUsd * 100) : 0;
  const availableAtomic = BigInt(availableCents) * USDC_ATOMIC_PER_CENT;
  const floorAtomic = BigInt(Math.max(0, params.floorCents)) * USDC_ATOMIC_PER_CENT;
  const remainingAfterRental = availableAtomic - BigInt(params.quoteAmountAtomic);
  if (remainingAfterRental < floorAtomic) {
    return err(
      "gateway credits balance cannot cover this rental right now: retry later or pick a cheaper market",
    );
  }
  return ok(undefined);
};

// The result of a successful provision. deploymentId is the credits-rail job
// address. The credits API returns no endpoint field, so endpoints are derived
// locally from the job definition's exposed ports (see serviceEndpoints.ts);
// each URL answers once the job reaches RUNNING. Batch results still come back
// by job id.
export interface ProvisionedDeployment {
  readonly deploymentId: string;
  readonly status: string;
  readonly endpoints: ServiceEndpoint[];
}

// A provisioning failure. On the credits rail one jobs.list call posts the job
// atomically, so there is no "created but not started" orphan to hand back and
// deploymentId is null. The field is kept because the refund path records it
// (audit H3) and a future recovery could carry a job id here.
export interface ProvisionFailure {
  readonly message: string;
  readonly deploymentId: string | null;
}

export interface ProvisionRequest {
  readonly marketAddress: string;
  readonly marketSlug: string;
  readonly durationMinutes: number;
  readonly jobDefinition: JobDefinition;
  readonly paymentKey: string;
}

// Read-only view of a deployment for the lifecycle routes.
export interface DeploymentSnapshot {
  readonly deploymentId: string;
  readonly status: string;
  readonly endpoints: ServiceEndpoint[];
  readonly timeoutMinutes: number;
  readonly marketAddress: string;
}

export interface ProvisioningService {
  readonly isConfigured: boolean;
  getCreditsBalance: () => Promise<Result<CreditsBalance>>;
  checkCreditsCoverQuote: (quote: RentQuote) => Promise<Result<void>>;
  provisionDeployment: (
    request: ProvisionRequest,
  ) => Promise<Result<ProvisionedDeployment, ProvisionFailure>>;
  getDeployment: (deploymentId: string) => Promise<Result<DeploymentSnapshot>>;
  extendDeployment: (
    deploymentId: string,
    additionalMinutes: number,
  ) => Promise<Result<DeploymentSnapshot>>;
  stopDeployment: (deploymentId: string) => Promise<Result<DeploymentSnapshot>>;
}

const describeApiError = (unknownError: unknown): string => {
  if (isNosanaApiError(unknownError)) {
    return unknownError.message;
  }
  return unknownError instanceof Error ? unknownError.message : String(unknownError);
};

// Nosana SDK calls are bare awaits with no cancellation. Bind the shared
// timeout wrapper to the Nosana call budget so a hung create/start does not pin
// a request that already holds a settled payment (audit H4).
const NOSANA_CALL_TIMEOUT_MS = 60_000;
const withTimeout = <OperationResult>(operation: Promise<OperationResult>, label: string) =>
  withTimeoutForCall(operation, label, NOSANA_CALL_TIMEOUT_MS);

// The credits rail expresses job timeouts in seconds; the gateway works in whole
// minutes. sourceRef: client-manager postJobsList/postJobsByAddressExtend
// ("Job timeout in seconds", "Number of seconds to extend the job").
const SECONDS_PER_MINUTE = 60;

// Credits-API job state is a number. sourceRef: live client.api.jobs.get shape
// and @nosana/kit JobState (QUEUED=0, RUNNING=1, COMPLETED=2, STOPPED=3).
const describeJobState = (state: unknown): string => {
  switch (state) {
    case 0:
      return "QUEUED";
    case 1:
      return "RUNNING";
    case 2:
      return "COMPLETED";
    case 3:
      return "STOPPED";
    default:
      return "UNKNOWN";
  }
};

// A credits-rail job id is the created job's on-chain account address. Guard
// against a create call that reports success with no usable id: settle has
// already moved money upstream by this point, so an empty or non-string id must
// become a refund-owed provision failure, never a 200 with a blank
// deployment_id that would hide the debt from the restart refund scan. Mirrors
// the isPlausibleSignature guard in paymentFlow.ts; kept minimal (non-empty
// string) so a real job whose id format is not a strict pubkey is never refunded
// by mistake.
export const isUsableJobId = (jobId: unknown): jobId is string =>
  typeof jobId === "string" && jobId.trim().length > 0;

const NOT_CONFIGURED_REASON =
  "gateway has no Nosana API key configured, so it cannot provision deployments";

export const createProvisioningService = (config: GatewayConfig): ProvisioningService => {
  const apiKey = config.nosanaApiKey;
  if (!apiKey) {
    return {
      isConfigured: false,
      getCreditsBalance: async () => err(NOT_CONFIGURED_REASON),
      checkCreditsCoverQuote: async () => err(NOT_CONFIGURED_REASON),
      provisionDeployment: async () => err({ message: NOT_CONFIGURED_REASON, deploymentId: null }),
      getDeployment: async () => err(NOT_CONFIGURED_REASON),
      extendDeployment: async () => err(NOT_CONFIGURED_REASON),
      stopDeployment: async () => err(NOT_CONFIGURED_REASON),
    };
  }

  const nosanaClient = createNosanaClient(config.nosanaNetwork, { api: { apiKey } });

  const getCreditsBalance: ProvisioningService["getCreditsBalance"] = async () => {
    let balance: { assignedCredits: number; reservedCredits: number; settledCredits: number };
    try {
      balance = await withTimeout(nosanaClient.api.credits.balance(), "credits.balance");
    } catch (balanceError) {
      return err(`credits balance check failed: ${describeApiError(balanceError)}`);
    }
    // Fields are USD dollars. Available is assigned minus what is reserved and
    // already settled.
    const availableUsd =
      balance.assignedCredits - balance.reservedCredits - balance.settledCredits;
    return ok({
      assignedUsd: balance.assignedCredits,
      reservedUsd: balance.reservedCredits,
      settledUsd: balance.settledCredits,
      availableUsd,
    });
  };

  const checkCreditsCoverQuote: ProvisioningService["checkCreditsCoverQuote"] = async (
    quote,
  ) => {
    const balanceResult = await getCreditsBalance();
    if (!balanceResult.ok) {
      return balanceResult;
    }
    return evaluateCreditsCoverage({
      availableUsd: balanceResult.value.availableUsd,
      quoteAmountAtomic: quote.amountAtomic,
      floorCents: config.minCreditsFloorCents,
    });
  };

  // Map the untyped credits-API job record to a lifecycle snapshot. The record
  // carries no endpoint field, so endpoints are derived from its jobDefinition;
  // timeout is in seconds. sourceRef: live client.api.jobs.get fields (state,
  // timeout, market, jobDefinition).
  const mapJobRecordToSnapshot = (
    deploymentId: string,
    jobRecord: Record<string, unknown>,
  ): DeploymentSnapshot => {
    const timeoutSeconds = typeof jobRecord.timeout === "number" ? jobRecord.timeout : 0;
    const marketAddress = typeof jobRecord.market === "string" ? jobRecord.market : "";
    return {
      deploymentId,
      status: describeJobState(jobRecord.state),
      endpoints: deriveServiceEndpointsFromRecord(
        jobRecord.jobDefinition,
        deploymentId,
        config.nosanaNetwork,
      ),
      timeoutMinutes: Math.ceil(timeoutSeconds / SECONDS_PER_MINUTE),
      marketAddress,
    };
  };

  const provisionDeployment: ProvisioningService["provisionDeployment"] = async (request) => {
    // The credits rail posts a job by IPFS hash, so the job definition is pinned
    // first. sourceRef: client-manager postJobsList requestBody { ipfsHash,
    // market, timeout }.
    let ipfsHash: string;
    try {
      ipfsHash = await withTimeout(nosanaClient.ipfs.pin(request.jobDefinition), "ipfs.pin");
    } catch (pinError) {
      // Nothing was posted, so there is nothing to recover.
      return err({
        message: `job definition IPFS pin failed: ${describeApiError(pinError)}`,
        deploymentId: null,
      });
    }
    // Post the job to the market, charged to the gateway's credits (Bearer nos_
    // API key). timeout is in SECONDS here, unlike the deployment-manager which
    // used minutes. sourceRef: client-manager postJobsList ("Job timeout in
    // seconds"); CreateJobWithCreditsResponse returns { tx, job, run, credits }.
    let created: Awaited<ReturnType<typeof nosanaClient.api.jobs.list>>;
    try {
      created = await withTimeout(
        nosanaClient.api.jobs.list({
          ipfsHash,
          market: request.marketAddress,
          timeout: request.durationMinutes * SECONDS_PER_MINUTE,
        }),
        "jobs.list",
      );
    } catch (listError) {
      // A transport failure here MAY still have posted the job. The gateway does
      // not auto-retry, so it records a refund owed rather than risk a double
      // post; a job that did land auto-stops at its timeout.
      return err({
        message: `credits job create failed: ${describeApiError(listError)}`,
        deploymentId: null,
      });
    }
    // The job is listed (QUEUED); a node picks it up. There is no separate start
    // call on the credits rail. Money already settled, so a create that returns
    // no usable job id is recorded for refund, not returned as a broken success.
    if (!isUsableJobId(created.job)) {
      return err({
        message: "credits job create reported success but returned no usable job id",
        deploymentId: null,
      });
    }
    return ok({
      deploymentId: created.job,
      status: "QUEUED",
      endpoints: deriveServiceEndpoints(
        request.jobDefinition,
        created.job,
        config.nosanaNetwork,
      ),
    });
  };

  const getDeployment: ProvisioningService["getDeployment"] = async (deploymentId) => {
    try {
      const jobRecord = (await withTimeout(
        nosanaClient.api.jobs.get(deploymentId),
        "jobs.get",
      )) as Record<string, unknown>;
      return ok(mapJobRecordToSnapshot(deploymentId, jobRecord));
    } catch (getError) {
      return err(`job lookup failed: ${describeApiError(getError)}`);
    }
  };

  const extendDeployment: ProvisioningService["extendDeployment"] = async (
    deploymentId,
    additionalMinutes,
  ) => {
    // extend adds seconds to the job's timeout and charges the extension to
    // credits. sourceRef: client-manager postJobsByAddressExtend { seconds }.
    try {
      await withTimeout(
        nosanaClient.api.jobs.extend({
          address: deploymentId,
          seconds: additionalMinutes * SECONDS_PER_MINUTE,
        }),
        "jobs.extend",
      );
    } catch (extendError) {
      return err(`job extend failed: ${describeApiError(extendError)}`);
    }
    // extend is the commit point: the extension is applied and charged. A failure
    // to re-read fresh state must NOT be reported as an extend failure, that
    // would refund an extension the renter already received (audit M2). Fall back
    // to a minimal snapshot that at least carries the added minutes.
    const refreshed = await getDeployment(deploymentId);
    if (refreshed.ok) {
      return refreshed;
    }
    return ok({
      deploymentId,
      status: "RUNNING",
      endpoints: [],
      timeoutMinutes: additionalMinutes,
      marketAddress: "",
    });
  };

  const stopDeployment: ProvisioningService["stopDeployment"] = async (deploymentId) => {
    // sourceRef: client-manager postJobsByAddressStop (takes the job address).
    try {
      await withTimeout(nosanaClient.api.jobs.stop(deploymentId), "jobs.stop");
    } catch (stopError) {
      return err(`job stop failed: ${describeApiError(stopError)}`);
    }
    return getDeployment(deploymentId);
  };

  return {
    isConfigured: true,
    getCreditsBalance,
    checkCreditsCoverQuote,
    provisionDeployment,
    getDeployment,
    extendDeployment,
    stopDeployment,
  };
};
