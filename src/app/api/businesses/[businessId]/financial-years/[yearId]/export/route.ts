import { NextResponse } from "next/server";

import { getCurrentIdentity } from "../../../../../../../modules/auth/session";
import { buildYearExport } from "../../../../../../../modules/accounting/export-service";
import { exportErrorResponse, identityRequired, moneyDependencies } from "../../../../../../../modules/accounting/money-route-support";
import { getPersistenceContext } from "../../../../../../../modules/persistence/repository-factory";
import { authenticatedRateLimitResponse } from "../../../../../../../modules/security/authenticated-rate-limit";
import type { BusinessId } from "../../../../../../../modules/tenancy/types";

type RouteContext = { params: Promise<{ businessId: string; yearId: string }> };

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function GET(request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return identityRequired();
  // The export reads and writes a whole workbook: it shares the file-transfer budget of uploads.
  const limited = await authenticatedRateLimitResponse("upload", request, actor);
  if (limited) return limited;
  try {
    const { businessId, yearId } = await context.params;
    const { report, year, bytes } = await buildYearExport(businessId as BusinessId, yearId, actor, { ...moneyDependencies(), storage: getPersistenceContext().storage });
    if (!bytes || !year) {
      return NextResponse.json({ error: { code: "EXPORT_BLOCKED", message: "The workbook cannot be exported yet." }, report }, { status: 409 });
    }
    const name = `accounts-${year.startDate}-${year.endDate}.xlsx`.replace(/[^A-Za-z0-9._-]/g, "_");
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Content-Length": String(bytes.length),
        "Content-Type": XLSX,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) { return exportErrorResponse(error); }
}
