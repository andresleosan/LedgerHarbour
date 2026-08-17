import { NextResponse } from "next/server";

import type { AuthIdentity } from "../auth/auth-provider";
import { authenticatedRateLimitResponse } from "../security/authenticated-rate-limit";

export async function platformRateLimitResponse(
  request: Request,
  identity: AuthIdentity,
): Promise<NextResponse | null> {
  return authenticatedRateLimitResponse("platform-administration", request, identity);
}
