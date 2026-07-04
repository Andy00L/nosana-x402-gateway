import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

// Single JSON error shape for every route: { error }. Distinct failure modes
// must produce distinct messages (REFERENCE_SECURITY_AUDIT.md always-on rule 8).
export const respondWithJsonError = (
  context: Context,
  statusCode: ContentfulStatusCode,
  errorMessage: string,
) => {
  console.warn(`[respondWithJsonError] ${statusCode}: ${errorMessage}`);
  return context.json({ error: errorMessage }, statusCode);
};
