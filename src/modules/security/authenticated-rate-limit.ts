import { NextResponse } from "next/server";

import type { AuthIdentity } from "../auth/auth-provider";
import { createAggregatedRateLimiter, createAuthenticatedRateLimiter, type AuthenticatedRateLimitScope } from "./rate-limit";
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

function firstHeaderValue(requestHeaders: Headers, name: string): string | null {
  return requestHeaders.get(name)?.split(",", 1)[0]?.trim() || null;
}

function requestAddress(requestHeaders: Headers): string {
  const vercelAddress = firstHeaderValue(requestHeaders, "x-vercel-forwarded-for");
  if (process.env.NODE_ENV === "production") return vercelAddress ?? "edge-unknown";
  if (vercelAddress) return vercelAddress;
  for (const name of ["x-vercel-forwarded-for", "x-forwarded-for", "x-real-ip"]) {
    const value = firstHeaderValue(requestHeaders, name);
    if (value) return value;
  }
  return "unknown";
}

export async function enforceAuthenticatedRateLimit(scope: AuthenticatedRateLimitScope, identityKey: string, requestHeaders: Headers): Promise<void> {
  if (typeof identityKey !== "string" || !identityKey.trim()) throw new AuthenticatedRateLimitUnavailableError();

  try {
    const address = requestAddress(requestHeaders);
    const [identityResult, aggregateResult] = await Promise.all([
      createAuthenticatedRateLimiter(scope).limit(`authenticated:${scope}:identity:${identityKey}`),
      createAggregatedRateLimiter(scope).limit(`authenticated:${scope}:address:${address}`),
    ]);
    if (!identityResult.success || !aggregateResult.success) throw new AuthenticatedRateLimitError();
  } catch (error) {
    if (error instanceof AuthenticatedRateLimitError) throw error;
    throw new AuthenticatedRateLimitUnavailableError();
  }
}

export async function authenticatedRateLimitResponse(
  scope: AuthenticatedRateLimitScope,
  request: Request,
  identity: AuthIdentity,
): Promise<NextResponse | null> {
  try {
    await enforceAuthenticatedRateLimit(scope, identity.providerUserId, request.headers);
    return null;
  } catch (error) {
    if (error instanceof AuthenticatedRateLimitError) {
      return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429 });
    }
    return NextResponse.json({ error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Platform protection is temporarily unavailable." } }, { status: 503 });
  }
}
