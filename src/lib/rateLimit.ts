import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "hono/bun";
import { respondWithJsonError } from "./httpError.js";

// Fixed-window rate limit for the public quote and rent surface: GET /markets
// and POST /rent (with or without a payment header). It applies to paid
// retries too, on purpose: exempting requests that merely CARRY a payment
// header would let anyone bypass the limit with a garbage header while still
// triggering the markets fan-out and two facilitator round-trips per request
// (audit finding A1). In-memory by design: the settlement ledger is the only
// durable state, and a restart resetting rate windows is harmless.

// Requests allowed per client per window. Sized for a legitimate agent: a
// rental costs 2 requests (quote plus paid retry), so one address can start
// 30 rentals a minute before throttling.
const REQUESTS_PER_WINDOW = 60;

// Window length in milliseconds.
const RATE_LIMIT_WINDOW_MS = 60_000;

// Ceiling on tracked clients so the window map cannot grow without bound
// (REFERENCE_SECURITY_AUDIT.md 3.6). Past it, expired windows are pruned; if
// every window is still live the map is cleared, which resets limits early but
// keeps memory bounded. An attacker holding that many source addresses defeats
// per-address limiting either way.
const MAX_TRACKED_CLIENTS = 10_000;

interface RateWindow {
  windowStartMs: number;
  requestCount: number;
}

export interface RateDecision {
  readonly allowed: boolean;
  // Whole seconds until the client's window resets; 0 when allowed.
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  check: (clientKey: string, nowMs?: number) => RateDecision;
}

export const createRateLimiter = (
  maxRequestsPerWindow: number = REQUESTS_PER_WINDOW,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
): RateLimiter => {
  const windowsByClient = new Map<string, RateWindow>();

  const pruneExpiredWindows = (nowMs: number): void => {
    for (const [clientKey, rateWindow] of windowsByClient) {
      if (nowMs - rateWindow.windowStartMs >= windowMs) {
        windowsByClient.delete(clientKey);
      }
    }
    if (windowsByClient.size > MAX_TRACKED_CLIENTS) {
      windowsByClient.clear();
    }
  };

  const check: RateLimiter["check"] = (clientKey, nowMs = Date.now()) => {
    const currentWindow = windowsByClient.get(clientKey);
    if (!currentWindow || nowMs - currentWindow.windowStartMs >= windowMs) {
      if (windowsByClient.size >= MAX_TRACKED_CLIENTS) {
        pruneExpiredWindows(nowMs);
      }
      windowsByClient.set(clientKey, { windowStartMs: nowMs, requestCount: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (currentWindow.requestCount >= maxRequestsPerWindow) {
      const millisecondsUntilReset = currentWindow.windowStartMs + windowMs - nowMs;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(millisecondsUntilReset / 1000)),
      };
    }
    currentWindow.requestCount += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  };

  return { check };
};

// The bucket key for a request. Direct connections use the socket's remote
// address (Bun conninfo). Behind a reverse proxy every socket belongs to the
// proxy, so TRUST_PROXY=1 switches to the first x-forwarded-for entry instead;
// trusting that header WITHOUT a proxy would let any client mint a fresh
// bucket per request, which is why it is opt-in (config.trustProxy).
const resolveClientKey = (context: Context, trustProxy: boolean): string => {
  if (trustProxy) {
    const forwardedFor = context.req.header("x-forwarded-for");
    const firstHop = forwardedFor?.split(",")[0]?.trim();
    if (firstHop) {
      return firstHop;
    }
  }
  try {
    const remoteAddress = getConnInfo(context).remote.address;
    if (remoteAddress) {
      return remoteAddress;
    }
  } catch {
    // Not running under Bun.serve (unit tests): fall through to the shared key.
  }
  return "unknown";
};

// Returns the 429 response to send, or null when the request is allowed.
// Kept as a plain function (not only middleware) so the rent routes can call
// it inline at the top of their handlers.
export const enforceRateLimit = (
  context: Context,
  limiter: RateLimiter,
  trustProxy: boolean,
): Response | null => {
  const decision = limiter.check(resolveClientKey(context, trustProxy));
  if (decision.allowed) {
    return null;
  }
  context.header("retry-after", String(decision.retryAfterSeconds));
  return respondWithJsonError(
    context,
    429,
    `too many requests from this address: retry in ${decision.retryAfterSeconds}s`,
  );
};

export const createRateLimitMiddleware = (
  limiter: RateLimiter,
  trustProxy: boolean,
): MiddlewareHandler => {
  return async (context, next) => {
    const rateRefusal = enforceRateLimit(context, limiter, trustProxy);
    if (rateRefusal) {
      return rateRefusal;
    }
    await next();
  };
};
