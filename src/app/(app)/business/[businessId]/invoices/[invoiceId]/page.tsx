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
  const { locale, setLocale, hrefFor } = useUrlLocale();
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
     <main className="review-page"><style>{`button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #e47d6c;outline-offset:3px}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:1ms!important;animation-iteration-count:1!important}}`}</style>
      <style>{`*{box-sizing:border-box}body{margin:0;background:#f7f8f5;color:#17313b;font-family:Inter,ui-sans-serif,system-ui,sans-serif}.review-page{min-height:100vh;padding:24px;background:linear-gradient(135deg,#f7f8f5,#edf3ef)}.shell{width:min(100%,1120px);margin:auto}.toolbar{display:flex;justify-content:flex-end;gap:8px;align-items:center;color:#49636b;font-size:.82rem}.locale{border:1px solid transparent;border-radius:999px;padding:8px 12px;background:transparent;color:#315b60;cursor:pointer;font:inherit;font-weight:750}.locale[aria-pressed=true]{border-color:#91b9ad;background:#fff}.back{display:inline-block;margin-top:42px;color:#0b6b66;font-weight:800}.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:22px;margin-top:22px}.card{padding:28px;border:1px solid #c6d8d0;border-radius:22px;background:#fff;box-shadow:0 18px 40px #17313b12}.card h1,.card h2{margin-top:0;letter-spacing:-.04em}.preview{min-height:560px;background:#17313b;color:#fff}.preview p{color:#d6e8e0;line-height:1.6}.preview a{display:inline-flex;margin-top:18px;padding:12px 15px;border-radius:10px;background:#c7e9db;color:#17313b;font-weight:800;text-decoration:none}.fields{display:grid;gap:13px}.field{display:grid;gap:6px}.field label{font-weight:750}.field input,.field textarea{width:100%;min-height:44px;border:1px solid #9fbab1;border-radius:9px;padding:10px;color:#17313b;font:inherit}.field textarea{min-height:82px}.low{border-color:#c77c52;background:#fff7ed}.confidence{font-size:.78rem;color:#8d4d2d}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}.actions button{min-height:44px;border:1px solid #0b6b66;border-radius:10px;padding:0 15px;background:#0b6b66;color:#fff;cursor:pointer;font:inherit;font-weight:800;transition:transform .18s ease,background-color .18s ease}.actions button:hover{background:#075b57;transform:translateY(-1px)}.actions button.secondary{border-color:#a65d48;background:#fff3ed;color:#7a3f31}.feedback{color:#0b6b66;font-weight:750}.error{color:#8d3f34;font-weight:750}@media(max-width:780px){.review-page{padding:18px}.grid{grid-template-columns:1fr}.preview{min-height:0}}button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #d46d42;outline-offset:3px}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}`}</style>
       <div className="shell"><div className="toolbar" aria-label={copy.languageLabel}><span>{copy.languageLabel}</span>{(["en", "es"] as const).map((candidate) => <button className="locale" key={candidate} type="button" aria-pressed={locale === candidate} onClick={() => setLocale(candidate)}>{candidate === "en" ? copy.localeEnglish : copy.localeSpanish}</button>)}</div><Link className="back" href={hrefFor(`/business/${businessId}/invoices`)}>LedgerHarbour / {copy.listTitle}</Link>
        {error && <p className="error" role="alert" aria-live="assertive">{error}</p>}{status && <p className="feedback" role="status" aria-live="polite">{status}</p>}
        <div className="grid"><section className="card preview" aria-labelledby="document-title"><h1 id="document-title">{copy.documentPreview}</h1><p>{payload?.document.originalFileName ?? copy.reviewError}</p>{payload && <a href={payload.documentDownloadUrl}>{copy.downloadDocument}</a>}</section><section className="card" aria-labelledby="fields-title"><h2 id="fields-title">{copy.extractedFields}</h2><div className="fields">{fields.map((field) => { const confidence = payload?.invoice.confidenceData?.[field]; const low = confidence !== undefined && confidence < .8; return <div className="field" key={field}><label htmlFor={field}>{labels[field]}{low && <span className="confidence"> {copy.lowConfidence} ({Math.round(confidence * 100)}%)</span>}</label>{field === "notes" ? <textarea id={field} className={low ? "low" : ""} value={values[field] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))} disabled={payload?.invoice.reviewState === "approved"} /> : <input id={field} className={low ? "low" : ""} value={values[field] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))} disabled={payload?.invoice.reviewState === "approved"} />}</div>; })}</div><div className="actions"><button type="button" disabled={busy || payload?.invoice.reviewState === "approved"} onClick={() => void save()}>{busy ? copy.saving : copy.save}</button><button className="secondary" type="button" disabled={busy || payload?.invoice.reviewState === "approved"} onClick={() => void approve()}>{copy.approve}</button></div></section></div>
      </div>
    </main>
  );
}
