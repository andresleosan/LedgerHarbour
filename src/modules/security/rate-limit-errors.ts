export const AUTHENTICATED_RATE_LIMIT_ERROR_CODE = "AUTHENTICATED_RATE_LIMITED" as const;
export const AUTHENTICATED_RATE_LIMIT_UNAVAILABLE_ERROR_CODE = "AUTHENTICATED_RATE_LIMIT_UNAVAILABLE" as const;

export class AuthenticatedRateLimitError extends Error {
  readonly code = AUTHENTICATED_RATE_LIMIT_ERROR_CODE;

  constructor() {
    super("Too many requests.");
    this.name = "AuthenticatedRateLimitError";
  }
}

export class AuthenticatedRateLimitUnavailableError extends Error {
  readonly code = AUTHENTICATED_RATE_LIMIT_UNAVAILABLE_ERROR_CODE;

  constructor() {
    super("Rate limiting is temporarily unavailable.");
    this.name = "AuthenticatedRateLimitUnavailableError";
  }
}
