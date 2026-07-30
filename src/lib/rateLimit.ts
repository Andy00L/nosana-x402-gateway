import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "hono/bun";
import { respondWithJsonError } from "./httpError.js";

// Fixed-window rate limit for the unpaid surface: GET /markets and the 402
// quote branches of the rent routes. The paid retry is metered by its payment;
// the unpaid path fans out to the Nosana markets API and the Solana RPC, so
// without a limit it can be spammed into upstream rate limits (the gap named
// in the README's honesty section). In-memory by design: the settlement ledger
// is the only durable state, and a restart resetting rate windows is harmless.

// Requests allowed per client per window. Sized for a legitimate agent
// (discover markets, take a few quotes, retry: tens of requests a minute),
// not a scraper.
export const UNPAID_REQUESTS_PER_WINDOW = 60;

// Window length in milliseconds.
export const RATE_LIMIT_WINDOW_MS = 60_000;

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
  maxRequestsPerWindow: number = UNPAID_REQUESTS_PER_WINDOW,
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
export const resolveClientKey = (context: Context, trustProxy: boolean): string => {
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
// Kept as a plain function (not only middleware) so the rent routes can apply
// it to their unpaid quote branch only, after they have seen the payment header.
export const enforceUnpaidRateLimit = (
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
    `too many unpaid requests from this address: retry in ${decision.retryAfterSeconds}s`,
  );
};

export const createUnpaidRateLimitMiddleware = (
  limiter: RateLimiter,
  trustProxy: boolean,
): MiddlewareHandler => {
  return async (context, next) => {
    const rateRefusal = enforceUnpaidRateLimit(context, limiter, trustProxy);
    if (rateRefusal) {
      return rateRefusal;
    }
    await next();
  };
};
