import { NextResponse } from "next/server";

import { getCurrentIdentity } from "../../../../../modules/auth/session";
import { getTemplate, importTemplate, TemplateError, TEMPLATE_ERROR_CODES, TEMPLATE_MAX_SIZE_BYTES } from "../../../../../modules/accounting/template-service";
import type { BusinessId } from "../../../../../modules/tenancy/types";
import { getPersistenceContext } from "../../../../../modules/persistence/repository-factory";
import { enforceAuthenticatedRateLimit } from "../../../../../modules/security/authenticated-rate-limit";
import { AuthenticatedRateLimitError } from "../../../../../modules/security/rate-limit-errors";

type RouteContext = { params: Promise<{ businessId: string }> };

const MAX_TEMPLATE_REQUEST_BODY_BYTES = TEMPLATE_MAX_SIZE_BYTES + 64 * 1024;

function responseFor(error: unknown): NextResponse {
  if (error instanceof TemplateError) {
    if (error.code === TEMPLATE_ERROR_CODES.TEMPLATE_UNREADABLE) {
      return NextResponse.json({ error: { code: error.readerCode ?? error.code, message: error.message } }, { status: 422 });
    }
    const status = error.code === TEMPLATE_ERROR_CODES.BUSINESS_ACCESS_DENIED ? 404 :
      error.code === TEMPLATE_ERROR_CODES.INSUFFICIENT_CAPABILITY || error.code === TEMPLATE_ERROR_CODES.INACTIVE_BUSINESS ? 403 :
      error.code === TEMPLATE_ERROR_CODES.TEMPLATE_TOO_LARGE ? 413 :
      error.code === TEMPLATE_ERROR_CODES.UNSUPPORTED_TEMPLATE_TYPE ? 415 :
      error.code === TEMPLATE_ERROR_CODES.TEMPLATE_REPOSITORY_CONFLICT ? 409 :
      error.code === TEMPLATE_ERROR_CODES.TEMPLATE_STORAGE_FAILURE ? 500 : 400;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "TEMPLATE_REQUEST_FAILED", message: "The template request could not be completed." } }, { status: 500 });
}

function requestLengthError(status: 411 | 413): NextResponse {
  return NextResponse.json({
    error: {
      code: status === 413 ? "UPLOAD_REQUEST_TOO_LARGE" : "UPLOAD_LENGTH_REQUIRED",
      message: "The upload request is invalid.",
    },
  }, { status });
}

function dependencies() {
  const persistence = getPersistenceContext();
  return {
    tenancyRepository: persistence.tenancyRepository,
    headings: persistence.headingRepository,
    templates: persistence.templateRepository,
    storage: persistence.storage,
  };
}

export async function GET(_request: Request, context: RouteContext) {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  try {
    return NextResponse.json(await getTemplate((await context.params).businessId as BusinessId, identity, dependencies()));
  } catch (error) { return responseFor(error); }
}

export async function POST(request: Request, context: RouteContext) {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  try {
    await enforceAuthenticatedRateLimit("upload", identity.providerUserId, request.headers);
  } catch (error) {
    if (error instanceof AuthenticatedRateLimitError || (error as { code?: unknown })?.code === "AUTHENTICATED_RATE_LIMITED") {
      return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429 });
    }
    return NextResponse.json({ error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Upload protection is temporarily unavailable." } }, { status: 503 });
  }
  const contentLength = request.headers.get("content-length");
  if (!contentLength || !/^\d+$/.test(contentLength.trim())) return requestLengthError(411);
  const requestBodyBytes = Number(contentLength);
  if (!Number.isSafeInteger(requestBodyBytes)) return requestLengthError(411);
  if (requestBodyBytes > MAX_TEMPLATE_REQUEST_BODY_BYTES) return requestLengthError(413);
  const { businessId } = await context.params;
  try {
    let form: FormData;
    try { form = await request.formData(); } catch { throw new TemplateError(TEMPLATE_ERROR_CODES.INVALID_TEMPLATE_FILE); }
    const value = form.get("file");
    if (typeof File === "undefined" || !(value instanceof File)) throw new TemplateError(TEMPLATE_ERROR_CODES.INVALID_TEMPLATE_FILE);
    const data = new Uint8Array(await value.arrayBuffer());
    return NextResponse.json(await importTemplate(businessId as BusinessId, { name: value.name, mimeType: value.type, data }, identity, dependencies()));
  } catch (error) { return responseFor(error); }
}
