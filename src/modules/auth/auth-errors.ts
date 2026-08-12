export const AUTH_ERROR_CODES = {
  INVALID_EMAIL: "AUTH_INVALID_EMAIL",
  MISSING_IDENTITY: "AUTH_MISSING_IDENTITY",
  DEVELOPMENT_MODE_REQUIRED: "AUTH_DEVELOPMENT_MODE_REQUIRED",
  PROVIDER_FAILURE: "AUTH_PROVIDER_FAILURE",
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

const publicMessages: Record<AuthErrorCode, string> = {
  [AUTH_ERROR_CODES.INVALID_EMAIL]: "Enter a valid email address.",
  [AUTH_ERROR_CODES.MISSING_IDENTITY]: "We could not find an active identity.",
  [AUTH_ERROR_CODES.DEVELOPMENT_MODE_REQUIRED]: "Development authentication is unavailable.",
  [AUTH_ERROR_CODES.PROVIDER_FAILURE]: "Authentication is temporarily unavailable.",
};

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, cause?: unknown) {
    super(publicMessages[code]);
    this.name = "AuthError";
    this.code = code;

    if (cause !== undefined) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        enumerable: false,
        value: cause,
        writable: false,
      });
    }
  }
}

export function toAuthError(error: unknown): AuthError {
  if (error instanceof AuthError) {
    return error;
  }

  if (error instanceof Error) {
    const matchingCode = (Object.entries(publicMessages) as [AuthErrorCode, string][]).find(
      ([, message]) => message === error.message,
    )?.[0];

    if (matchingCode) {
      return new AuthError(matchingCode, error);
    }
  }

  return new AuthError(AUTH_ERROR_CODES.PROVIDER_FAILURE, error);
}
