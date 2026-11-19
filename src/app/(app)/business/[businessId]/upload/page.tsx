"use client";

import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";

import { messages } from "@/i18n/config";
import { useUrlLocale } from "@/ui/useUrlLocale";

type SafeDocument = { id: string; originalFileName: string; status: string };
type UploadState = "queued" | "uploading" | "reading" | "done" | "failed";
type UploadItem = { key: number; file: File; previewUrl: string | null; state: UploadState; documentId?: string; errorCode?: string };

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_FILES = ".pdf,.jpg,.jpeg,.png,.heic,.tif,.tiff,application/pdf,image/jpeg,image/png,image/heic,image/tiff";
const stepValue: Record<UploadState, number> = { queued: 0, uploading: 1, reading: 2, done: 3, failed: 3 };

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
  RATE_LIMITED: "rateLimitError",
} as const satisfies Record<string, keyof typeof messages.en.documents>;

function messageForError(code: string | undefined, copy: typeof messages.en.documents): string {
  return copy[documentErrorMessageKeys[code as keyof typeof documentErrorMessageKeys] ?? "storageError"];
}

async function errorCodeOf(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null) as { error?: { code?: string } } | null;
  return payload?.error?.code ?? fallback;
}

export default function UploadPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = use(params);
  const { locale, hrefFor } = useUrlLocale();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const nextKeyRef = useRef(0);
  const previewUrlsRef = useRef<string[]>([]);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [brokenPreviews, setBrokenPreviews] = useState<Set<number>>(new Set());
  const copy = messages[locale].documents;

  useEffect(() => {
    const previewUrls = previewUrlsRef.current;
    return () => previewUrls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const update = (key: number, change: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)));
  };

  // ponytail: stepwise states only; send the upload with XMLHttpRequest and upload.onprogress for byte progress.
  const run = async ({ key, file }: UploadItem) => {
    if (file.size > MAX_FILE_BYTES) { update(key, { state: "failed", errorCode: "DOCUMENT_TOO_LARGE" }); return; }
    update(key, { state: "uploading" });
    try {
      const form = new FormData();
      form.set("file", file);
      const uploaded = await fetch(`/api/businesses/${businessId}/documents`, { method: "POST", body: form });
      if (!uploaded.ok) { update(key, { state: "failed", errorCode: await errorCodeOf(uploaded, "UPLOAD_FAILED") }); return; }
      const document = await uploaded.json() as SafeDocument;
      update(key, { state: "reading", documentId: document.id });
      const processed = await fetch(`/api/documents/${document.id}/process`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!processed.ok) {
        const code = await errorCodeOf(processed, "OCR_PROCESSING_FAILED");
        update(key, { state: "failed", errorCode: code === "RATE_LIMITED" ? code : "OCR_PROCESSING_FAILED" });
        return;
      }
      update(key, { state: "done" });
    } catch {
      update(key, { state: "failed", errorCode: "UPLOAD_FAILED" });
    }
  };

  const addFiles = (input: HTMLInputElement) => {
    const added = Array.from(input.files ?? []).map((file): UploadItem => {
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      if (previewUrl) previewUrlsRef.current.push(previewUrl);
      return { key: nextKeyRef.current++, file, previewUrl, state: "queued" };
    });
    input.value = "";
    setItems((current) => [...current, ...added]);
    for (const item of added) queueRef.current = queueRef.current.then(() => run(item));
  };

  // Files picked before hydration never reached onChange; queue them once React is attached.
  useEffect(() => {
    for (const input of [cameraInputRef.current, filesInputRef.current]) if (input?.files?.length) addFiles(input);
  }, []);

  const statusText = (item: UploadItem) => {
    if (item.state === "failed") return messageForError(item.errorCode, copy);
    if (item.state === "queued") return copy.queued;
    if (item.state === "uploading") return copy.uploading;
    if (item.state === "reading") return copy.reading;
    return copy.done;
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
            <input ref={cameraInputRef} hidden aria-label={copy.cameraLabel} type="file" accept="image/*" capture="environment" onChange={(event) => addFiles(event.currentTarget)} />
            <input ref={filesInputRef} hidden aria-label={copy.fileLabel} type="file" multiple accept={ACCEPTED_FILES} onChange={(event) => addFiles(event.currentTarget)} />
            <div className="upload-actions">
              <button className="primary-button" type="button" onClick={() => cameraInputRef.current?.click()}>{copy.cameraAction}</button>
              <button className="tertiary-button" type="button" onClick={() => filesInputRef.current?.click()}>{copy.chooseAction}</button>
            </div>
            <p className="page-description upload-hint">{copy.limit}</p>
          </div>
          {items.length > 0 && (
            <ul className="upload-queue" aria-label={copy.queueLabel}>
              {items.map((item) => (
                <li className="upload-item" key={item.key}>
                  {item.previewUrl && !brokenPreviews.has(item.key)
                    ? <img className="upload-thumb" src={item.previewUrl} alt="" onError={() => setBrokenPreviews((current) => new Set(current).add(item.key))} />
                    : <span className="upload-thumb" aria-hidden="true">{item.file.name.includes(".") ? item.file.name.split(".").pop()?.toUpperCase().slice(0, 4) : "FILE"}</span>}
                  <div className="upload-item-body">
                    <p className="upload-name">{item.file.name}</p>
                    {item.state !== "failed" && <progress max={3} value={stepValue[item.state]} aria-hidden="true" />}
                    <p className={item.state === "failed" ? "page-error" : "page-feedback"} role="status" aria-live="polite">{statusText(item)}</p>
                    {item.documentId && (
                      <p className="upload-links">
                        <Link href={`/api/documents/${item.documentId}/download`}>{copy.download.replace("{name}", item.file.name)}</Link>
                        {item.state === "done" && <Link href={hrefFor(`/business/${businessId}/invoices`)}>{copy.reviewLink}</Link>}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
