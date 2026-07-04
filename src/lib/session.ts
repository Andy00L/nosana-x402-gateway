import { sign, verify } from "hono/jwt";
import { type Result, ok, err } from "./result.js";

// Grace window in seconds after the rental ends during which the session JWT
// stays valid for status and stop calls.
const SESSION_GRACE_SECONDS = 3600;

export interface RentSessionClaims {
  readonly deployment_id: string;
  readonly payer: string | null;
  readonly tx_signature: string;
  readonly iat: number;
  readonly exp: number;
  [claimName: string]: string | number | null;
}

export const createRentSession = async (params: {
  deploymentId: string;
  payer: string | null;
  txSignature: string;
  durationMinutes: number;
  jwtSecret: string;
}): Promise<string> => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const claims: RentSessionClaims = {
    deployment_id: params.deploymentId,
    payer: params.payer,
    tx_signature: params.txSignature,
    iat: nowSeconds,
    exp: nowSeconds + params.durationMinutes * 60 + SESSION_GRACE_SECONDS,
  };
  // HS256 pinned explicitly on both sign and verify so a library default
  // change can never downgrade the algorithm silently.
  return sign(claims, params.jwtSecret, "HS256");
};

// Session check for the lifecycle routes: the JWT must verify AND its
// deployment_id claim must match the route parameter, so one rental's session
// never reaches another rental's deployment. Distinct reasons per failure mode.
export const verifyRentSession = async (params: {
  authorizationHeader: string | undefined;
  expectedDeploymentId: string;
  jwtSecret: string;
}): Promise<Result<RentSessionClaims>> => {
  const { authorizationHeader, expectedDeploymentId, jwtSecret } = params;
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    return err('missing session: send "Authorization: Bearer <session>" from the rent response');
  }
  const sessionToken = authorizationHeader.slice("Bearer ".length);
  let decodedClaims: Record<string, unknown>;
  try {
    decodedClaims = await verify(sessionToken, jwtSecret, "HS256");
  } catch {
    return err("session invalid or expired");
  }
  const { deployment_id, tx_signature, payer, iat, exp } = decodedClaims;
  if (typeof deployment_id !== "string" || typeof tx_signature !== "string") {
    return err("session payload is malformed");
  }
  if (deployment_id !== expectedDeploymentId) {
    return err("session does not grant access to this deployment");
  }
  return ok({
    deployment_id,
    tx_signature,
    payer: typeof payer === "string" ? payer : null,
    iat: typeof iat === "number" ? iat : 0,
    exp: typeof exp === "number" ? exp : 0,
  });
};
