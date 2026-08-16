"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useRef, useState } from "react";

import { messages } from "@/i18n/config";
import { useUrlLocale } from "@/ui/useUrlLocale";

type SafeDocument = { id: string; originalFileName: string; status: string };

const documentErrorMessageKeys = {
  INVALID_UPLOAD: "invalidUploadError",
  UPLOAD_FAILED: "storageError",
  DOCUMENT_STORAGE_FAILURE: "storageError",
  INVALID_UPLOAD_METADATA: "metadataError",
  EMPTY_DOCUMENT: "emptyError",
  DOCUMENT_TOO_LARGE: "sizeError",
  DOCUMENT_SIZE_MISMATCH: "sizeMismatchError",
  UNSUPPORTED_DOCUMENT_FORMAT: "formatError",
  DOCUMENT_MIME_EXTENSION_MISMATCH: "metadataMismatchError",
  DOCUMENT_SIGNATURE_MISMATCH: "corruptError",
  BUSINESS_ACCESS_DENIED: "accessError",
  INACTIVE_BUSINESS: "inactiveError",
  BUSINESS_NOT_FOUND: "businessError",
  DOCUMENT_DUPLICATE_CHECKSUM: "duplicateError",
  IDENTITY_REQUIRED: "identityError",
  DOCUMENT_NOT_FOUND: "downloadError",
  DOWNLOAD_FAILED: "downloadError",
  OCR_PROCESSING_FAILED: "processingError",
} as const satisfies Record<string, keyof typeof messages.en.documents>;

function messageForError(code: string | undefined, copy: typeof messages.en.documents): string {
  return copy[documentErrorMessageKeys[code as keyof typeof documentErrorMessageKeys] ?? "storageError"];
}

export default function UploadPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = use(params);
  const { locale, hrefFor } = useUrlLocale();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [document, setDocument] = useState<SafeDocument | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const copy = messages[locale].documents;

  const upload = async () => {
    const selectedFile = file ?? fileInputRef.current?.files?.[0] ?? null;
    if (!selectedFile) { setErrorCode("UNSUPPORTED_DOCUMENT_FORMAT"); return; }
    setErrorCode(null); setDocument(null); setUploading(true);
    try {
      const form = new FormData();
      form.set("file", selectedFile);
      const response = await fetch(`/api/businesses/${businessId}/documents`, { method: "POST", body: form });
      const payload = await response.json() as SafeDocument & { error?: { code?: string } };
      if (!response.ok) { setErrorCode(payload.error?.code ?? "UPLOAD_FAILED"); return; }
      setDocument(payload);
    } catch {
      setErrorCode("UPLOAD_FAILED");
    } finally {
      setUploading(false);
    }
  };

  const process = async () => {
    if (!document) return;
    setErrorCode(null); setProcessing(true);
    try {
      const response = await fetch(`/api/documents/${document.id}/process`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) { setErrorCode("OCR_PROCESSING_FAILED"); return; }
      router.push(`/business/${businessId}/invoices?locale=${locale}`);
    } catch {
      setErrorCode("OCR_PROCESSING_FAILED");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <main className="operational-page upload-page">
      <div className="page-shell upload-shell">
        <Link className="page-back" href={hrefFor(`/business/${businessId}/members`)}>{copy.brand} / {copy.back}</Link>
        <section className="page-card upload-card" aria-labelledby="upload-title">
          <p className="page-eyebrow">{copy.eyebrow}</p>
          <h1 className="page-title" id="upload-title">{copy.title}</h1>
          <p className="page-description">{copy.description}</p>
          <div className="upload-drop">
            <label htmlFor="invoice-file">{copy.fileLabel}</label>
            <input className="page-input" ref={fileInputRef} id="invoice-file" aria-label={copy.fileLabel} type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.tif,.tiff,application/pdf,image/jpeg,image/png,image/heic,image/tiff" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <p className="page-description upload-hint">{copy.limit}</p>
            <button className="primary-button" type="button" onClick={() => void upload()} disabled={uploading || processing}>{uploading ? copy.uploading : copy.uploadAction}</button>
          </div>
          {errorCode && <p className="page-error" role="alert">{messageForError(errorCode, copy)}</p>}
          {document && <p className="page-feedback" role="status" aria-live="polite">{copy.uploaded.replace("{status}", document.status)} <Link href={`/api/documents/${document.id}/download`}>{copy.download.replace("{name}", document.originalFileName)}</Link> <button className="tertiary-button" type="button" onClick={() => void process()} disabled={uploading || processing}>{processing ? copy.processing : copy.processAction}</button></p>}
        </section>
      </div>
    </main>
  );
}
