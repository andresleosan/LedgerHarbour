import { NextResponse } from "next/server";

import { getCurrentIdentity } from "../../../../../../../modules/auth/session";
import { buildYearAnnex, downloadYearAnnex } from "../../../../../../../modules/accounting/annex-service";
import { exportErrorResponse, identityRequired, moneyDependencies } from "../../../../../../../modules/accounting/money-route-support";
import { invoiceRouteDependencies } from "../../../../../../../modules/invoices/invoice-route-support";
import { authenticatedRateLimitResponse } from "../../../../../../../modules/security/authenticated-rate-limit";
import type { BusinessId } from "../../../../../../../modules/tenancy/types";

type RouteContext = { params: Promise<{ businessId: string; yearId: string }> };

/** The closing annex: a CSV that travels with the workbook, or `?format=json` for the screen. */
export async function GET(request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return identityRequired();
  const asJson = new URL(request.url).searchParams.get("format") === "json";
  // The file download shares the export's file-transfer budget; the screen's JSON does not.
  if (!asJson) {
    const limited = await authenticatedRateLimitResponse("upload", request, actor);
    if (limited) return limited;
  }
  try {
    const { businessId, yearId } = await context.params;
    const dependencies = { ...invoiceRouteDependencies(), ...moneyDependencies() };
    if (asJson) {
      const response = NextResponse.json(await buildYearAnnex(businessId as BusinessId, yearId, actor, dependencies));
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    const { annex, csv } = await downloadYearAnnex(businessId as BusinessId, yearId, actor, dependencies);
    const name = `closing-notes-${annex.year.startDate}-${annex.year.endDate}.csv`.replace(/[^A-Za-z0-9._-]/g, "_");
    return new Response(csv, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Content-Type": "text/csv; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) { return exportErrorResponse(error); }
}
