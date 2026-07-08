import {
  getJobExposedServices,
  validateJobDefinition,
  NosanaNetwork,
  type JobDefinition,
} from "@nosana/kit";

// A live service URL for one exposed port of a running job, in the same shape
// the deployment-manager returns endpoints (sourceRef: @nosana/api
// dist/client/deployment-manager/schema.d.ts, components.schemas.Endpoint).
export interface ServiceEndpoint {
  readonly opId: string;
  readonly port: number | string;
  readonly url: string;
}

// FRP ingress domain the GPU host publishes exposed ports on, per network.
// The credits API returns no endpoint field, but the URL is deterministic:
// subdomain = getExposeIdHash(jobAddress, opIndex, port), the same derivation
// nosana-cli getJobUrls uses (sourceRef: nosana-cli src/generic/expose-util.ts;
// domain from its FRP_SERVER_ADDRESS config, env "prd" for mainnet and "dev"
// otherwise, sourceRef: nosana-cli NodeConfigs.ts). The mainnet domain and the
// derivation were verified live on 2026-07-08: credits-rail job
// DZDySeNqJHorzSkNCSwtWWyzbUFj7fdnRhDoHfsjTbGC (nginx, expose 80) answered
// HTTP 200 at the derived URL. Localnet has no public ingress, so it maps to
// no domain and jobs there return no endpoints.
const EXPOSE_DOMAIN_BY_NETWORK: Record<NosanaNetwork, string | null> = {
  [NosanaNetwork.MAINNET]: "node.k8s.prd.nos.ci",
  [NosanaNetwork.DEVNET]: "node.k8s.dev.nos.ci",
  [NosanaNetwork.LOCALNET]: null,
};

// The kit signals a private job (args.private: true) by returning the literal
// hash "private" instead of a derivable id; its URL is not public, so it is
// filtered out rather than turned into a dead link.
// sourceRef: @nosana/endpoints getJobExposedServices.
const PRIVATE_SERVICE_HASH = "private";

// Derive the public service URLs for every exposed port of a job posted on the
// credits rail. Pure: no network calls, safe to run per request.
export const deriveServiceEndpoints = (
  jobDefinition: JobDefinition,
  jobAddress: string,
  network: NosanaNetwork,
): ServiceEndpoint[] => {
  const exposeDomain = EXPOSE_DOMAIN_BY_NETWORK[network];
  if (!exposeDomain || jobAddress.length === 0) {
    return [];
  }
  return getJobExposedServices(jobDefinition, jobAddress)
    .filter((exposedService) => exposedService.hash !== PRIVATE_SERVICE_HASH)
    .map((exposedService) => ({
      opId: exposedService.opId,
      port: exposedService.port,
      url: `https://${exposedService.hash}.${exposeDomain}`,
    }));
};

// Same derivation for the untyped job record the credits API returns on
// jobs.get, where jobDefinition arrives as unknown JSON. A record whose
// definition does not validate yields no endpoints instead of an error: the
// lifecycle snapshot must stay readable even for a job this gateway would not
// have accepted itself.
export const deriveServiceEndpointsFromRecord = (
  rawJobDefinition: unknown,
  jobAddress: string,
  network: NosanaNetwork,
): ServiceEndpoint[] => {
  const validation = validateJobDefinition(rawJobDefinition);
  if (!validation.success) {
    return [];
  }
  return deriveServiceEndpoints(validation.data, jobAddress, network);
};
