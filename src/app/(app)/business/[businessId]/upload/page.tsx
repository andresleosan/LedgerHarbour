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
  const { locale, setLocale, hrefFor } = useUrlLocale();
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
      const response = await fetch(`/api/documents/${document.id}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) { setErrorCode("OCR_PROCESSING_FAILED"); return; }
      router.push(`/business/${businessId}/invoices?locale=${locale}`);
    } catch {
      setErrorCode("OCR_PROCESSING_FAILED");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <main className="upload-page">
      <style>{`:root { color-scheme: light; } * { box-sizing: border-box; } body { margin: 0; background: #f8f4ec; color: #10283d; font-family: Inter, ui-sans-serif, system-ui, sans-serif; } .upload-page { min-height: 100vh; padding: 24px; background: radial-gradient(circle at 85% 5%, rgba(49,154,145,.16), transparent 30%), #f8f4ec; } .upload-shell { width: min(100%, 760px); margin: 0 auto; } .toolbar { display: flex; justify-content: flex-end; gap: 10px; align-items: center; color: #4c6270; font-size: .82rem; } .locale-button { border: 0; border-radius: 7px; padding: 7px 9px; background: transparent; color: #4c6270; cursor: pointer; font: inherit; font-weight: 700; } .locale-button[aria-pressed="true"] { background: #d9eeea; color: #0b6663; } .back { display: inline-block; margin-top: 56px; color: #0b7772; font-weight: 750; } .upload-card { margin-top: 26px; padding: clamp(24px, 5vw, 52px); border: 1px solid #cbd9d5; border-radius: 22px; background: #fffdf8; box-shadow: 0 18px 45px rgba(16,40,61,.08); } .eyebrow { margin: 0 0 14px; color: #0b7772; font-size: .76rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; } h1 { margin: 0; font-size: clamp(2.3rem, 6vw, 4.4rem); line-height: 1; letter-spacing: -.06em; } .description { margin: 20px 0 30px; color: #536572; line-height: 1.6; } .drop-area { display: grid; gap: 12px; padding: 28px; border: 2px dashed #8db6b0; border-radius: 14px; background: #f5fbf8; } input { min-height: 44px; max-width: 100%; } button { min-height: 44px; border: 1px solid #0b7772; border-radius: 10px; padding: 0 16px; background: #0b7772; color: white; cursor: pointer; font: inherit; font-weight: 750; } button:disabled { opacity: .65; cursor: wait; } button:focus-visible, a:focus-visible, input:focus-visible { outline: 3px solid #d46d42; outline-offset: 3px; } .hint { margin: 0; color: #536572; font-size: .88rem; } .error { color: #793e35; font-weight: 700; } .success { color: #0b6663; font-weight: 750; } @media (max-width: 600px) { .upload-page { padding: 18px; } .back { margin-top: 38px; } .drop-area { padding: 20px; } } @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; } }`}</style>
       <style>{`button { transition: transform .18s ease, background-color .18s ease; } @media (max-width: 650px) { .upload-page { padding: 20px 14px; } .upload-card { padding: 24px 18px; } .drop-area { padding: 20px 16px; } } @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; } }`}</style>
      <div className="upload-shell">
        <div className="toolbar" aria-label={copy.languageLabel}><span>{copy.languageLabel}</span>{(["en", "es"] as const).map((candidate) => <button className="locale-button" key={candidate} type="button" aria-pressed={locale === candidate} onClick={() => setLocale(candidate)}>{candidate === "en" ? copy.localeEnglish : copy.localeSpanish}</button>)}</div>
         <Link className="back" href={hrefFor(`/business/${businessId}/members`)}>{copy.brand} / {copy.back}</Link>
        <section className="upload-card" aria-labelledby="upload-title"><p className="eyebrow">{copy.eyebrow}</p><h1 id="upload-title">{copy.title}</h1><p className="description">{copy.description}</p>
           <div className="drop-area"><label htmlFor="invoice-file">{copy.fileLabel}</label><input ref={fileInputRef} id="invoice-file" aria-label={copy.fileLabel} type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.tif,.tiff,application/pdf,image/jpeg,image/png,image/heic,image/tiff" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><p className="hint">{copy.limit}</p><button type="button" onClick={() => void upload()} disabled={uploading || processing}>{uploading ? copy.uploading : copy.uploadAction}</button></div>
           {errorCode && <p className="error" role="alert">{messageForError(errorCode, copy)}</p>}
           {document && <p className="success" role="status" aria-live="polite">{copy.uploaded.replace("{status}", document.status)} <Link href={`/api/documents/${document.id}/download`}>{copy.download.replace("{name}", document.originalFileName)}</Link> <button type="button" onClick={() => void process()} disabled={uploading || processing}>{processing ? copy.processing : copy.processAction}</button></p>}
        </section>
      </div>
    </main>
  );
}
