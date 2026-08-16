import { headers } from "next/headers";

import { AUTH_ERROR_CODES, AuthError } from "../auth/auth-errors";
import { createAuthRateLimiter } from "./rate-limit";

function requestAddress(requestHeaders: Headers): string {
  return requestHeaders.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
    requestHeaders.get("x-real-ip")?.trim() || "unknown";
}

export async function enforceAuthRateLimit(scope: "email" | "google", identityKey = ""): Promise<void> {
  const requestHeaders = await headers();
  const key = `auth:${scope}:${requestAddress(requestHeaders)}:${identityKey.trim().toLowerCase()}`;
  const result = await createAuthRateLimiter().limit(key);
  if (!result.success) throw new AuthError(AUTH_ERROR_CODES.PROVIDER_FAILURE);
}
