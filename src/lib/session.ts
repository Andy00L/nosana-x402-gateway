import { sign } from "hono/jwt";

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
  return sign(claims, params.jwtSecret);
};
