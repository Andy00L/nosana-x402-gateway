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
  provisionDeployment: (request: ProvisionRequest) => Promise<Result<ProvisionedDeployment>>;
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

const NOT_CONFIGURED_REASON =
  "gateway has no Nosana API key configured, so it cannot provision deployments";

export const createProvisioningService = (config: GatewayConfig): ProvisioningService => {
  const apiKey = config.nosanaApiKey;
  if (!apiKey) {
    return {
      isConfigured: false,
      getCreditsBalance: async () => err(NOT_CONFIGURED_REASON),
      checkCreditsCoverQuote: async () => err(NOT_CONFIGURED_REASON),
      provisionDeployment: async () => err(NOT_CONFIGURED_REASON),
      getDeployment: async () => err(NOT_CONFIGURED_REASON),
      extendDeployment: async () => err(NOT_CONFIGURED_REASON),
      stopDeployment: async () => err(NOT_CONFIGURED_REASON),
    };
  }

  const nosanaClient = createNosanaClient(config.nosanaNetwork, { api: { apiKey } });

  const getCreditsBalance: ProvisioningService["getCreditsBalance"] = async () => {
    let balance: { assignedCredits: number; reservedCredits: number; settledCredits: number };
    try {
      balance = await nosanaClient.api.credits.balance();
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
      deployment = await nosanaClient.api.deployments.create({
        name: deploymentName,
        market: request.marketAddress,
        replicas: 1,
        // Timeout is in minutes (sourceRef: @nosana/api deployment-manager
        // schema DeploymentCreateBody).
        timeout: request.durationMinutes,
        strategy: DeploymentStrategy.SIMPLE,
        job_definition: request.jobDefinition,
      });
    } catch (createError) {
      return err(`deployment create failed: ${describeApiError(createError)}`);
    }
    try {
      await deployment.start();
    } catch (startError) {
      // The deployment exists but is not running; surface its id so the
      // refund/recovery path can find it.
      return err(
        `deployment start failed after create (deployment_id=${deployment.id}): ${describeApiError(startError)}`,
      );
    }
    return ok({
      deploymentId: deployment.id,
      status: deployment.status,
      endpoints: deployment.endpoints,
    });
  };

  const fetchDeploymentHandle = async (deploymentId: string) => {
    return nosanaClient.api.deployments.get(deploymentId);
  };

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
    try {
      // updateTimeout sets the TOTAL timeout in minutes, so extending means
      // current timeout plus the paid extension (sourceRef: @nosana/api
      // ApiDeployment.updateTimeout and DeploymentCreateBody.timeout).
      await deployment.updateTimeout(deployment.timeout + additionalMinutes);
    } catch (updateError) {
      return err(`deployment extend failed: ${describeApiError(updateError)}`);
    }
    return getDeployment(deploymentId);
  };

  const stopDeployment: ProvisioningService["stopDeployment"] = async (deploymentId) => {
    let deployment: Awaited<ReturnType<typeof fetchDeploymentHandle>>;
    try {
      deployment = await fetchDeploymentHandle(deploymentId);
    } catch (getError) {
      return err(`deployment lookup failed: ${describeApiError(getError)}`);
    }
    try {
      await deployment.stop();
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
