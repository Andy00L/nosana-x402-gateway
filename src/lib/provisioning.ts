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

export interface ProvisioningService {
  readonly isConfigured: boolean;
  checkCreditsCoverQuote: (quote: RentQuote) => Promise<Result<void>>;
  provisionDeployment: (request: ProvisionRequest) => Promise<Result<ProvisionedDeployment>>;
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
      checkCreditsCoverQuote: async () => err(NOT_CONFIGURED_REASON),
      provisionDeployment: async () => err(NOT_CONFIGURED_REASON),
    };
  }

  const nosanaClient = createNosanaClient(config.nosanaNetwork, { api: { apiKey } });

  const checkCreditsCoverQuote: ProvisioningService["checkCreditsCoverQuote"] = async (
    quote,
  ) => {
    let balance: { assignedCredits: number; reservedCredits: number; settledCredits: number };
    try {
      balance = await nosanaClient.api.credits.balance();
    } catch (balanceError) {
      return err(`credits balance check failed: ${describeApiError(balanceError)}`);
    }
    const availableCents = Math.floor(
      balance.assignedCredits - balance.reservedCredits - balance.settledCredits,
    );
    const availableMicroUsd = availableCents > 0 ? BigInt(availableCents) * MICRO_USD_PER_CENT : 0n;
    if (availableMicroUsd < BigInt(quote.amountAtomic)) {
      return err(
        "gateway credits balance cannot cover this rental right now: retry later or pick a cheaper market",
      );
    }
    return ok(undefined);
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

  return { isConfigured: true, checkCreditsCoverQuote, provisionDeployment };
};
