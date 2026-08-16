import { NextResponse } from "next/server";

import { getCurrentIdentity } from "../../../../../modules/auth/session";
import { DocumentError, DOCUMENT_ERROR_CODES, getDocumentForDownload } from "../../../../../modules/documents/document-service";
import { getPersistenceContext } from "../../../../../modules/persistence/repository-factory";

type RouteContext = { params: Promise<{ documentId: string }> };

function errorResponse(error: unknown): NextResponse {
  if (error instanceof DocumentError) {
    const status = error.code === DOCUMENT_ERROR_CODES.DOCUMENT_NOT_FOUND ? 404 :
      error.code === DOCUMENT_ERROR_CODES.INACTIVE_BUSINESS || error.code === DOCUMENT_ERROR_CODES.BUSINESS_ACCESS_DENIED ? 403 : 500;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "DOWNLOAD_FAILED", message: "The document could not be downloaded." } }, { status: 500 });
}

export async function GET(_request: Request, context: RouteContext) {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  const { documentId } = await context.params;
  try {
     const persistence = getPersistenceContext();
     const { document, stream } = await getDocumentForDownload(documentId, identity, {
       tenancyRepository: persistence.tenancyRepository,
       documentRepository: persistence.documentRepository,
       storage: persistence.storage,
     });
    const safeName = document.originalFileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180) || "document";
    return new Response(stream, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Content-Length": String(document.originalSizeBytes),
        "Content-Type": document.originalMimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
