import { NextResponse } from "next/server";
import { z } from "zod";

import type { AuthIdentity } from "../../../../../modules/auth/auth-provider";
import { moneyErrorResponse } from "../../../../../modules/accounting/money-route-support";
import { DATE_FORMATS, STATEMENT_MAX_BYTES } from "../../../../../modules/accounting/statement-csv";
import { STATEMENT_IMPORT_ERROR_CODES, StatementImportError } from "../../../../../modules/accounting/statement-import-service";
import { enforceAuthenticatedRateLimit } from "../../../../../modules/security/authenticated-rate-limit";
import { AuthenticatedRateLimitError } from "../../../../../modules/security/rate-limit-errors";

/** The page sends the file's text inside JSON; the cap leaves room for the JSON around it. */
export const MAX_STATEMENT_REQUEST_BODY_BYTES = STATEMENT_MAX_BYTES + 64 * 1024;

const column = z.number().int().min(0).max(100_000);
const mappingSchema = z.union([
  z.object({ date: column, description: column, reference: column.optional(), amount: column }).strict(),
  z.object({ date: column, description: column, reference: column.optional(), moneyIn: column, moneyOut: column }).strict(),
]);

export const statementBodySchema = z.object({
  accountId: z.string(),
  csv: z.string(),
  mapping: mappingSchema.optional(),
  dateFormat: z.enum(DATE_FORMATS).optional(),
}).strict();

function lengthError(status: 411 | 413): NextResponse {
  return NextResponse.json({ error: { code: status === 413 ? "UPLOAD_REQUEST_TOO_LARGE" : "UPLOAD_LENGTH_REQUIRED", message: "The upload request is invalid." } }, { status });
}

/** The upload guards of the template route: rate limit, then a declared and capped body length. */
export async function guardStatementUpload(request: Request, identity: AuthIdentity): Promise<NextResponse | null> {
  try {
    await enforceAuthenticatedRateLimit("upload", identity.providerUserId, request.headers);
  } catch (error) {
    if (error instanceof AuthenticatedRateLimitError || (error as { code?: unknown })?.code === "AUTHENTICATED_RATE_LIMITED") {
      return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429 });
    }
    return NextResponse.json({ error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Upload protection is temporarily unavailable." } }, { status: 503 });
  }
  const contentLength = request.headers.get("content-length");
  if (!contentLength || !/^\d+$/.test(contentLength.trim())) return lengthError(411);
  const bytes = Number(contentLength);
  if (!Number.isSafeInteger(bytes)) return lengthError(411);
  if (bytes > MAX_STATEMENT_REQUEST_BODY_BYTES) return lengthError(413);
  return null;
}

/** File problems are 413 (too large) or 422; line errors travel with the refusal. Everything else maps like the money routes. */
export function statementErrorResponse(error: unknown): NextResponse {
  if (error instanceof StatementImportError) {
    const status = error.code === STATEMENT_IMPORT_ERROR_CODES.TOO_LARGE ? 413 : 422;
    return NextResponse.json({ error: { code: error.code, message: error.message }, ...(error.errors.length ? { errors: error.errors } : {}) }, { status });
  }
  return moneyErrorResponse(error);
}
