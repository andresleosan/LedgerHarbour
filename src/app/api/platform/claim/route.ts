import { NextResponse } from "next/server";

import { getCurrentIdentity } from "../../../../modules/auth/session";
import { createPlatformService, PlatformError } from "../../../../modules/platform/platform-service";
import { getPersistenceContext } from "../../../../modules/persistence/repository-factory";

export async function POST() {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  try {
    const persistence = getPersistenceContext();
    const member = await createPlatformService({
      tenancyRepository: persistence.tenancyRepository,
      platformRepository: persistence.platformRepository,
    }).claimPlatformMember(identity);
    return NextResponse.json({ platformMember: { id: member.id, role: member.role } });
  } catch (error) {
    if (error instanceof PlatformError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 403 });
    return NextResponse.json({ error: { code: "PLATFORM_REQUEST_FAILED", message: "The platform request could not be completed." } }, { status: 500 });
  }
}
