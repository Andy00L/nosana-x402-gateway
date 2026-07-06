import {
  createNosanaClient,
  isNosanaApiError,
  DeploymentStrategy,
  type JobDefinition,
} from "@nosana/kit";
import { type Result, ok, err } from "./result.js";
import type { GatewayConfig } from "../config.js";
import type { RentQuote } from "./pricing.js";

// 1 USD cent equals 10^4 USDC atomic units (USDC has 6 decimals). The credits
// balance is expressed in USD cents (sourceRef: @nosana/api client-manager
// schema, getCreditsBalance: "Credits assigned to the user in USD cents").
const MICRO_USD_PER_CENT = 10_000n;

// The gateway's spendable credits, in USD cents, as read from Nosana.
// availableCents is the amount left after reservations and settled spend.
export interface CreditsBalance {
  readonly assignedCents: number;
  readonly reservedCents: number;
  readonly settledCents: number;
  readonly availableCents: number;
}

// Coverage decision, extracted as a pure function so it is unit-testable
// without a network client. Refuses when settling this rental would drop the
// balance below the configured float floor. All comparisons are integer
// BigInt math (no float on money).
export const evaluateCreditsCoverage = (params: {
  availableCents: number;
  quoteAmountAtomic: string;
  floorCents: number;
}): Result<void> => {
  const availableMicroUsd =
    params.availableCents > 0 ? BigInt(params.availableCents) * MICRO_USD_PER_CENT : 0n;
  const floorMicroUsd = BigInt(Math.max(0, params.floorCents)) * MICRO_USD_PER_CENT;
  const remainingAfterRental = availableMicroUsd - BigInt(params.quoteAmountAtomic);
  if (remainingAfterRental < floorMicroUsd) {
    return err(
      "gateway credits balance cannot cover this rental right now: retry later or pick a cheaper market",
    );
  }
  return ok(undefined);
};

export interface ProvisionedDeployment {
  readonly deploymentId: string;
  readonly status: string;
  readonly endpoints: { opId: string; port: number | string; url: string }[];
}

// A provisioning failure carries the deployment id when one was created before
// the failure (start failed after a successful create), so the refund/recovery
// path can find and stop the orphaned deployment (audit H3).
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
  readonly endpoints: { opId: string; port: number | string; url: string }[];
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

// Nosana SDK calls are bare awaits with no cancellation. Wrap each in a timeout
// so a hung create/start does not pin a request that already holds a settled
// payment (audit H4). The underlying call is not truly cancelled, but the
// request stops waiting and returns a distinct error instead of hanging.
const NOSANA_CALL_TIMEOUT_MS = 60_000;
const withTimeout = async <OperationResult>(
  operation: Promise<OperationResult>,
  label: string,
): Promise<OperationResult> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutGuard = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`${label} timed out after ${NOSANA_CALL_TIMEOUT_MS}ms`)),
      NOSANA_CALL_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([operation, timeoutGuard]);
  } finally {
    clearTimeout(timeoutHandle);
  }
};

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
    // Floor to whole cents; assigned minus what is reserved and already settled
    // is what remains spendable.
    const availableCents = Math.floor(
      balance.assignedCredits - balance.reservedCredits - balance.settledCredits,
    );
    return ok({
      assignedCents: balance.assignedCredits,
      reservedCents: balance.reservedCredits,
      settledCents: balance.settledCredits,
      availableCents,
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
      availableCents: balanceResult.value.availableCents,
      quoteAmountAtomic: quote.amountAtomic,
      floorCents: config.minCreditsFloorCents,
    });
  };

  const provisionDeployment: ProvisioningService["provisionDeployment"] = async (request) => {
    // Deployment name carries the payment key prefix so any deployment can be
    // traced back to the payment that funded it.
    const deploymentName = `x402-${request.paymentKey.slice(0, 12)}`;
    let deployment: Awaited<ReturnType<typeof nosanaClient.api.deployments.create>>;
    try {
      deployment = await withTimeout(
        nosanaClient.api.deployments.create({
          name: deploymentName,
          market: request.marketAddress,
          replicas: 1,
          // Timeout is in minutes (sourceRef: @nosana/api deployment-manager
          // schema DeploymentCreateBody).
          timeout: request.durationMinutes,
          strategy: DeploymentStrategy.SIMPLE,
          job_definition: request.jobDefinition,
        }),
        "deployments.create",
      );
    } catch (createError) {
      // No deployment was created, so there is nothing to recover.
      return err({
        message: `deployment create failed: ${describeApiError(createError)}`,
        deploymentId: null,
      });
    }
    try {
      await withTimeout(deployment.start(), "deployment.start");
    } catch (startError) {
      // The deployment exists but did not start: return its id so the
      // refund/recovery path can find and stop it (audit H3).
      return err({
        message: `deployment start failed after create: ${describeApiError(startError)}`,
        deploymentId: deployment.id,
      });
    }
    return ok({
      deploymentId: deployment.id,
      status: deployment.status,
      endpoints: deployment.endpoints,
    });
  };

  const fetchDeploymentHandle = async (deploymentId: string) =>
    withTimeout(nosanaClient.api.deployments.get(deploymentId), "deployments.get");

  const mapDeploymentToSnapshot = (
    deployment: Awaited<ReturnType<typeof fetchDeploymentHandle>>,
  ): DeploymentSnapshot => ({
    deploymentId: deployment.id,
    status: deployment.status,
    endpoints: deployment.endpoints,
    timeoutMinutes: deployment.timeout,
    marketAddress: deployment.market,
  });

  const getDeployment: ProvisioningService["getDeployment"] = async (deploymentId) => {
    try {
      return ok(mapDeploymentToSnapshot(await fetchDeploymentHandle(deploymentId)));
    } catch (getError) {
      return err(`deployment lookup failed: ${describeApiError(getError)}`);
    }
  };

  const extendDeployment: ProvisioningService["extendDeployment"] = async (
    deploymentId,
    additionalMinutes,
  ) => {
    let deployment: Awaited<ReturnType<typeof fetchDeploymentHandle>>;
    try {
      deployment = await fetchDeploymentHandle(deploymentId);
    } catch (getError) {
      return err(`deployment lookup failed: ${describeApiError(getError)}`);
    }
    // updateTimeout sets the TOTAL timeout in minutes, so extending means
    // current timeout plus the paid extension (sourceRef: @nosana/api
    // ApiDeployment.updateTimeout and DeploymentCreateBody.timeout).
    const newTotalTimeout = deployment.timeout + additionalMinutes;
    try {
      await withTimeout(deployment.updateTimeout(newTotalTimeout), "deployment.updateTimeout");
    } catch (updateError) {
      return err(`deployment extend failed: ${describeApiError(updateError)}`);
    }
    // updateTimeout is the commit point: the extension is applied. A failure to
    // re-read fresh state must NOT be reported as an extend failure, that would
    // refund an extension the renter already received (audit M2). Fall back to
    // a snapshot built from the just-applied timeout.
    const refreshed = await getDeployment(deploymentId);
    if (refreshed.ok) {
      return refreshed;
    }
    return ok({
      deploymentId,
      status: deployment.status,
      endpoints: deployment.endpoints,
      timeoutMinutes: newTotalTimeout,
      marketAddress: deployment.market,
    });
  };

  const stopDeployment: ProvisioningService["stopDeployment"] = async (deploymentId) => {
    let deployment: Awaited<ReturnType<typeof fetchDeploymentHandle>>;
    try {
      deployment = await fetchDeploymentHandle(deploymentId);
    } catch (getError) {
      return err(`deployment lookup failed: ${describeApiError(getError)}`);
    }
    try {
      await withTimeout(deployment.stop(), "deployment.stop");
    } catch (stopError) {
      return err(`deployment stop failed: ${describeApiError(stopError)}`);
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
