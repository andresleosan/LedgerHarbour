"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

import { messages } from "@/i18n/config";
import { useUrlLocale } from "@/ui/useUrlLocale";

type Invoice = Record<string, string | null> & { id: string; reviewState: string; confidenceData: Record<string, number> };
type ReviewPayload = { invoice: Invoice; document: { originalFileName: string; originalMimeType: string }; documentDownloadUrl: string; error?: { code?: string } };
const fields = ["supplier", "invoiceNumber", "invoiceDate", "dueDate", "subtotal", "taxAmount", "total", "currencyReference", "expenseCategoryReference", "notes"] as const;

function messageForError(code: string | undefined, copy: typeof messages.en.invoices): string {
  if (code === "INVALID_INVOICE_STATE") return copy.approvedEditError;
  if (code === "INVOICE_INVALID_FOR_APPROVAL") return copy.approvalRequired;
  if (code === "INVOICE_NOT_FOUND" || code === "DOCUMENT_NOT_FOUND") return copy.notFoundError;
  if (code === "BUSINESS_ACCESS_DENIED" || code === "INSUFFICIENT_CAPABILITY") return copy.accessError;
  if (code === "INVOICE_REPOSITORY_CONFLICT") return copy.conflictError;
  if (code === "NETWORK_ERROR") return copy.networkError;
  return copy.reviewError;
}

export default function InvoiceReviewPage({ params }: { params: Promise<{ businessId: string; invoiceId: string }> }) {
  const { businessId, invoiceId } = use(params);
  const { locale, hrefFor } = useUrlLocale();
  const [payload, setPayload] = useState<ReviewPayload | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = messages[locale].invoices;

  useEffect(() => {
    void fetch(`/api/invoices/${invoiceId}/review`).then(async (response) => {
      const next = await response.json() as ReviewPayload;
      if (!response.ok) { setError(messageForError(next.error?.code, copy)); return; }
      setPayload(next);
      setValues(Object.fromEntries(fields.map((field) => [field, next.invoice[field] ?? ""])));
    }).catch(() => setError(messageForError("NETWORK_ERROR", copy)));
  }, [invoiceId]);

  const save = async () => {
    setBusy(true); setError(null); setStatus(null);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/review`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const result = await response.json() as ReviewPayload;
      if (!response.ok) { setError(messageForError(result.error?.code, copy)); return; }
      setPayload((current) => current ? { ...current, invoice: result.invoice } : result);
      setStatus(copy.saved);
    } catch { setError(messageForError("NETWORK_ERROR", copy)); } finally { setBusy(false); }
  };

  const approve = async () => {
    if (!window.confirm(copy.approveConfirm)) return;
    setBusy(true); setError(null); setStatus(null);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/review`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve" }) });
      const result = await response.json() as ReviewPayload;
      if (!response.ok) { setError(messageForError(result.error?.code, copy)); return; }
      setPayload((current) => current ? { ...current, invoice: result.invoice } : result);
      setStatus(copy.approved);
    } catch { setError(messageForError("NETWORK_ERROR", copy)); } finally { setBusy(false); }
  };

  const labels: Record<string, string> = { supplier: copy.supplier, invoiceNumber: copy.invoiceNumber, invoiceDate: copy.invoiceDate, dueDate: copy.dueDate, subtotal: copy.subtotal, taxAmount: copy.taxAmount, total: copy.total, currencyReference: copy.currency, expenseCategoryReference: copy.category, notes: copy.notes };
  return (
    <main className="operational-page review-page">
      <div className="page-shell review-shell">
        <Link className="page-back" href={hrefFor(`/business/${businessId}/invoices`)}>LedgerHarbour / {copy.listTitle}</Link>
        {error && <p className="page-error" role="alert" aria-live="assertive">{error}</p>}{status && <p className="page-feedback" role="status" aria-live="polite">{status}</p>}
        <div className="review-grid">
          <section className="page-card review-preview" aria-labelledby="document-title"><h1 className="page-title" id="document-title">{copy.documentPreview}</h1><p>{payload?.document.originalFileName ?? copy.reviewError}</p>{payload && <a className="tertiary-button" href={payload.documentDownloadUrl}>{copy.downloadDocument}</a>}</section>
          <section className="page-card" aria-labelledby="fields-title"><h2 className="page-title" id="fields-title">{copy.extractedFields}</h2><div className="review-fields">{fields.map((field) => { const confidence = payload?.invoice.confidenceData?.[field]; const low = confidence !== undefined && confidence < .8; return <div className="review-field" key={field}><label htmlFor={field}>{labels[field]}{low && <span className="confidence"> {copy.lowConfidence} ({Math.round(confidence * 100)}%)</span>}</label>{field === "notes" ? <textarea id={field} className={`page-textarea${low ? " low-confidence" : ""}`} value={values[field] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))} disabled={payload?.invoice.reviewState === "approved"} /> : <input id={field} className={`page-input${low ? " low-confidence" : ""}`} value={values[field] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))} disabled={payload?.invoice.reviewState === "approved"} />}</div>; })}</div><div className="review-actions"><button className="primary-button" type="button" disabled={busy || payload?.invoice.reviewState === "approved"} onClick={() => void save()}>{busy ? copy.saving : copy.save}</button><button className="secondary-button" type="button" disabled={busy || payload?.invoice.reviewState === "approved"} onClick={() => void approve()}>{copy.approve}</button></div></section>
        </div>
      </div>
    </main>
  );
}
