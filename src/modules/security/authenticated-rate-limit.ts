import { createAuthenticatedRateLimiter, type AuthenticatedRateLimitScope } from "./rate-limit";

export const AUTHENTICATED_RATE_LIMIT_ERROR_CODE = "AUTHENTICATED_RATE_LIMITED" as const;

export class AuthenticatedRateLimitError extends Error {
  readonly code = AUTHENTICATED_RATE_LIMIT_ERROR_CODE;

  constructor() {
    super("Too many requests.");
    this.name = "AuthenticatedRateLimitError";
  }
}

export async function enforceAuthenticatedRateLimit(scope: AuthenticatedRateLimitScope, identityKey: string): Promise<void> {
  if (typeof identityKey !== "string" || !identityKey.trim()) throw new AuthenticatedRateLimitError();

  try {
    const result = await createAuthenticatedRateLimiter(scope).limit(`authenticated:${scope}:${identityKey}`);
    if (!result.success) throw new AuthenticatedRateLimitError();
  } catch (error) {
    if (error instanceof AuthenticatedRateLimitError) throw error;
    throw new AuthenticatedRateLimitError();
  }
}
