import { NextResponse } from "next/server";

import {
  assertProductionConfiguration,
  ProductionConfigurationError,
} from "./modules/config/production-gate";

export function middleware() {
  try {
    assertProductionConfiguration();
    return NextResponse.next();
  } catch (error) {
    if (!(error instanceof ProductionConfigurationError)) throw error;

    return NextResponse.json(
      { error: { code: "SERVICE_UNAVAILABLE", message: "Service configuration is unavailable." } },
      { status: 503 },
    );
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
