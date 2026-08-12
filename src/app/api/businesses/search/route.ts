import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../modules/auth/session";
import { OnboardingError, searchBusinesses } from "../../../../modules/tenancy/business-service";

const querySchema = z.object({ q: z.string() });

export async function GET(request: Request) {
  const identity = getCurrentIdentity();
  if (!identity) {
    return NextResponse.json(
      { error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ q: url.searchParams.get("q") ?? "" });
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_SEARCH_QUERY", message: "Enter a business name to search." } },
      { status: 400 },
    );
  }

  try {
    const results = await searchBusinesses(parsed.data.q, identity);
    return NextResponse.json(results);
  } catch (error) {
    if (error instanceof OnboardingError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 400 });
    }
    return NextResponse.json(
      { error: { code: "INVALID_SEARCH_QUERY", message: "Enter a business name to search." } },
      { status: 400 },
    );
  }
}
