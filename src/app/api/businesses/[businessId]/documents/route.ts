import { NextResponse } from "next/server";

import { getCurrentIdentity } from "../../../../../modules/auth/session";
import {
  createDocument,
  DocumentError,
  DOCUMENT_ERROR_CODES,
  toSafeDocument,
} from "../../../../../modules/documents/document-service";
import { UploadValidationError, UPLOAD_ERROR_CODES, validateUpload } from "../../../../../modules/documents/file-validation";
import type { BusinessId } from "../../../../../modules/tenancy/types";

type RouteContext = { params: Promise<{ businessId: string }> };

function errorResponse(error: unknown): NextResponse {
  if (error instanceof UploadValidationError) {
    const status = error.code === UPLOAD_ERROR_CODES.FILE_TOO_LARGE ? 413 : 400;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  if (error instanceof DocumentError) {
    const status = error.code === DOCUMENT_ERROR_CODES.DUPLICATE_CHECKSUM ? 409 :
      error.code === DOCUMENT_ERROR_CODES.INACTIVE_BUSINESS || error.code === DOCUMENT_ERROR_CODES.BUSINESS_ACCESS_DENIED ? 403 :
      error.code === DOCUMENT_ERROR_CODES.BUSINESS_NOT_FOUND ? 404 :
      error.code === DOCUMENT_ERROR_CODES.STORAGE_FAILURE ? 500 : 400;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "INVALID_UPLOAD", message: "The document could not be uploaded." } }, { status: 400 });
}

export async function POST(request: Request, context: RouteContext) {
  const identity = getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  const { businessId } = await context.params;
  try {
    const form = await request.formData();
    const value = form.get("file");
    if (typeof File === "undefined" || !(value instanceof File)) throw new Error("missing file");
    if (value.size > 10 * 1024 * 1024) {
      throw new UploadValidationError(UPLOAD_ERROR_CODES.FILE_TOO_LARGE);
    }
    const data = new Uint8Array(await value.arrayBuffer());
    const upload = validateUpload({ name: value.name, mimeType: value.type, sizeBytes: value.size, data });
    const document = await createDocument({ businessId: businessId as BusinessId, upload }, identity);
    return NextResponse.json(toSafeDocument(document), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
