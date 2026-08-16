import { createAuthenticatedRateLimiter, type AuthenticatedRateLimitScope } from "./rate-limit";
import {
  AuthenticatedRateLimitError,
  AuthenticatedRateLimitUnavailableError,
} from "./rate-limit-errors";

export {
  AUTHENTICATED_RATE_LIMIT_ERROR_CODE,
  AUTHENTICATED_RATE_LIMIT_UNAVAILABLE_ERROR_CODE,
  AuthenticatedRateLimitError,
  AuthenticatedRateLimitUnavailableError,
} from "./rate-limit-errors";

function requestAddress(requestHeaders: Headers): string {
  for (const name of ["x-vercel-forwarded-for", "x-forwarded-for", "x-real-ip"]) {
    const value = requestHeaders.get(name)?.split(",", 1)[0]?.trim();
    if (value) return value;
  }
  return "unknown";
}

export async function enforceAuthenticatedRateLimit(scope: AuthenticatedRateLimitScope, identityKey: string, requestHeaders: Headers): Promise<void> {
  if (typeof identityKey !== "string" || !identityKey.trim()) throw new AuthenticatedRateLimitUnavailableError();

  try {
    const result = await createAuthenticatedRateLimiter(scope).limit(`authenticated:${scope}:${identityKey}:${requestAddress(requestHeaders)}`);
    if (!result.success) throw new AuthenticatedRateLimitError();
  } catch (error) {
    if (error instanceof AuthenticatedRateLimitError) throw error;
    throw new AuthenticatedRateLimitUnavailableError();
  }
}
