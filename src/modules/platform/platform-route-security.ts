import { NextResponse } from "next/server";

import type { AuthIdentity } from "../auth/auth-provider";
import { enforceAuthenticatedRateLimit } from "../security/authenticated-rate-limit";
import {
  AuthenticatedRateLimitError,
  AuthenticatedRateLimitUnavailableError,
} from "../security/rate-limit-errors";

export async function platformRateLimitResponse(
  request: Request,
  identity: AuthIdentity,
): Promise<NextResponse | null> {
  try {
    await enforceAuthenticatedRateLimit("platform-administration", identity.providerUserId, request.headers);
    return null;
  } catch (error) {
    if (error instanceof AuthenticatedRateLimitError) {
      return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429 });
    }
    if (error instanceof AuthenticatedRateLimitUnavailableError) {
      return NextResponse.json({ error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Platform protection is temporarily unavailable." } }, { status: 503 });
    }
    return NextResponse.json({ error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Platform protection is temporarily unavailable." } }, { status: 503 });
  }
}
