"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

import { messages } from "@/i18n/config";
import type { AccountHeading, HeadingGroup } from "@/modules/accounting/heading-service";
import { formatPence, parsePounds } from "@/modules/accounting/money";
import { useUrlLocale } from "@/ui/useUrlLocale";

type Invoice = Record<string, string | null> & { id: string; reviewState: string; confidenceData: Record<string, number> };
type CodingLine = { headingId: string; amount: string };
type ReviewPayload = { invoice: Invoice; coding: CodingLine[]; suggestedHeadingId: string | null; document: { originalFileName: string; originalMimeType: string }; documentDownloadUrl: string; error?: { code?: string } };
type Copy = typeof messages.en.invoices;
const fields = ["supplier", "invoiceNumber", "invoiceDate", "dueDate", "subtotal", "taxAmount", "total", "currencyReference", "notes"] as const;
const GROUPS: HeadingGroup[] = ["income", "cost_of_sales", "expenses", "assets", "liabilities", "equity"];
const MAX_LINES = 20;
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);

function messageForError(code: string | undefined, copy: Copy): string {
  if (code === "INVALID_INVOICE_STATE") return copy.approvedEditError;
  if (code === "INVOICE_INVALID_FOR_APPROVAL") return copy.approvalRequired;
  if (code === "INVOICE_NOT_FOUND" || code === "DOCUMENT_NOT_FOUND") return copy.notFoundError;
  if (code === "BUSINESS_ACCESS_DENIED" || code === "INSUFFICIENT_CAPABILITY") return copy.accessError;
  if (code === "INVOICE_REPOSITORY_CONFLICT") return copy.conflictError;
  if (code === "NETWORK_ERROR") return copy.networkError;
  return copy.reviewError;
}

/** Plain words for a coding error, shown next to the code control; null for any other error. */
function codingMessageFor(code: string | undefined, copy: Copy): string | null {
  if (code === "CODING_REQUIRED") return copy.codingRequired;
  if (code === "CODING_TOTAL_MISMATCH") return copy.codingMismatch;
  if (code === "HEADING_NOT_FOUND" || code === "HEADING_NOT_USABLE") return copy.codingHeadingError;
  if (code === "CODING_DUPLICATE_HEADING") return copy.codingDuplicate;
  if (code === "INVALID_CODING") return copy.codingInvalid;
  return null;
}

function penceOf(text: string | undefined): number | null {
  try {
    return parsePounds((text ?? "").trim());
  } catch {
    return null;
  }
}

export default function InvoiceReviewPage({ params }: { params: Promise<{ businessId: string; invoiceId: string }> }) {
  const { businessId, invoiceId } = use(params);
  const { locale, hrefFor } = useUrlLocale();
  const [payload, setPayload] = useState<ReviewPayload | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [headings, setHeadings] = useState<AccountHeading[] | null>(null);
  const [lines, setLines] = useState<CodingLine[]>([{ headingId: "", amount: "" }]);
  const [split, setSplit] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const [codingError, setCodingError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = messages[locale].invoices;
  const groupLabels = messages[locale].workbookSettings.groups;

  useEffect(() => {
    // A superseded load (strict-mode remount, new params) must not overwrite what the user has started editing.
    let active = true;
    void Promise.all([fetch(`/api/invoices/${invoiceId}/review`), fetch(`/api/businesses/${businessId}/headings`)]).then(async ([response, headingsResponse]) => {
      const next = await response.json() as ReviewPayload;
      if (!active) return;
      if (!response.ok) { setError(messageForError(next.error?.code, copy)); return; }
      if (!headingsResponse.ok) { setError(copy.reviewError); return; }
      const loadedHeadings = await headingsResponse.json() as AccountHeading[];
      if (!active) return;
      setHeadings(loadedHeadings);
      setPayload(next);
      setValues(Object.fromEntries(fields.map((field) => [field, next.invoice[field] ?? ""])));
      if (next.coding.length > 0) {
        setLines(next.coding);
        setSplit(next.coding.length > 1);
      } else if (next.suggestedHeadingId) {
        setLines([{ headingId: next.suggestedHeadingId, amount: "" }]);
        setSuggested(true);
      }
    }).catch(() => { if (active) setError(messageForError("NETWORK_ERROR", copy)); });
    return () => { active = false; };
  }, [invoiceId, businessId]);

  const totalPence = penceOf(values.total);
  const leftPence = totalPence === null ? null : lines.reduce((left, line) => left - (penceOf(line.amount) ?? 0), totalPence);

  // One line carries the whole total implicitly; split lines must leave nothing to assign.
  // undefined keeps the stored coding (a single code with no usable total yet); null stops the save.
  const codingPayload = (): CodingLine[] | null | undefined => {
    if (!split) {
      const headingId = lines[0]?.headingId ?? "";
      if (!headingId) return [];
      return totalPence !== null && totalPence > 0 ? [{ headingId, amount: formatPence(totalPence) }] : undefined;
    }
    if (lines.some((line) => !line.headingId || penceOf(line.amount) === null)) { setCodingError(copy.codingInvalid); return null; }
    if (leftPence !== 0) { setCodingError(copy.codingLeftError); return null; }
    return lines.map((line) => ({ headingId: line.headingId, amount: formatPence(penceOf(line.amount)!) }));
  };

  const showFailure = (code: string | undefined) => {
    const codingMessage = codingMessageFor(code, copy);
    if (codingMessage) setCodingError(codingMessage); else setError(messageForError(code, copy));
  };

  const save = async () => {
    setError(null); setStatus(null); setCodingError(null);
    const coding = codingPayload();
    if (coding === null) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/review`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(coding === undefined ? values : { ...values, coding }) });
      const result = await response.json() as Invoice & { error?: { code?: string } };
      if (!response.ok) { showFailure(result.error?.code); return; }
      setPayload((current) => current && { ...current, invoice: result });
      if (coding !== undefined) setSuggested(false);
      setStatus(copy.saved);
    } catch { setError(messageForError("NETWORK_ERROR", copy)); } finally { setBusy(false); }
  };

  const approve = async () => {
    if (!window.confirm(copy.approveConfirm)) return;
    setBusy(true); setError(null); setStatus(null); setCodingError(null);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/review`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve" }) });
      const result = await response.json() as Invoice & { error?: { code?: string } };
      if (!response.ok) { showFailure(result.error?.code); return; }
      setPayload((current) => current && { ...current, invoice: result });
      setStatus(copy.approved);
    } catch { setError(messageForError("NETWORK_ERROR", copy)); } finally { setBusy(false); }
  };

  const changeLine = (index: number, change: Partial<CodingLine>) => {
    setLines((current) => current.map((line, at) => at === index ? { ...line, ...change } : line));
    if (change.headingId !== undefined) setSuggested(false);
  };
  const startSplit = () => { setSplit(true); setLines((current) => [{ headingId: current[0]?.headingId ?? "", amount: "" }, { headingId: "", amount: "" }]); };
  const removeLine = (index: number) => {
    const next = lines.filter((_, at) => at !== index);
    setLines(next);
    if (next.length === 1) setSplit(false);
  };

  const approved = payload?.invoice.reviewState === "approved";
  const chosen = new Set(lines.map((line) => line.headingId));
  const usable = (heading: AccountHeading) => heading.isActive && heading.blockedReason === null;
  // A stored code that has since been deactivated stays visible so the select never shows a wrong value.
  const offered = (headings ?? []).filter((heading) => usable(heading) || chosen.has(heading.id));
  const codeSelect = (line: CodingLine, index: number, label: string) => (
    <div className="review-field">
      <label htmlFor={`coding-heading-${index}`}>{label}</label>
      <select id={`coding-heading-${index}`} className="page-input" value={line.headingId} onChange={(event) => changeLine(index, { headingId: event.target.value })} disabled={approved} aria-describedby={codingError ? "coding-error" : undefined}>
        <option value="">{copy.chooseCode}</option>
        {GROUPS.map((group) => {
          const items = offered.filter((heading) => heading.group === group);
          return items.length === 0 ? null : <optgroup key={group} label={groupLabels[group]}>{items.map((heading) => <option key={heading.id} value={heading.id}>{heading.displayName}</option>)}</optgroup>;
        })}
      </select>
    </div>
  );

  const labels: Record<string, string> = { supplier: copy.supplier, invoiceNumber: copy.invoiceNumber, invoiceDate: copy.invoiceDate, dueDate: copy.dueDate, subtotal: copy.subtotal, taxAmount: copy.taxAmount, total: copy.total, currencyReference: copy.currency, notes: copy.notes };
  return (
    <main className="operational-page review-page">
      <div className="page-shell review-shell">
        <Link className="page-back" href={hrefFor(`/business/${businessId}/invoices`)}>LedgerHarbour / {copy.listTitle}</Link>
        {error && <p className="page-error" role="alert" aria-live="assertive">{error}</p>}{status && <p className="page-feedback" role="status" aria-live="polite">{status}</p>}
        <div className="review-grid">
          <section className="page-card review-preview" aria-labelledby="document-title"><h1 className="page-title" id="document-title">{copy.documentPreview}</h1><p>{payload?.document.originalFileName ?? copy.reviewError}</p>{payload && <a className="tertiary-button" href={payload.documentDownloadUrl}>{copy.downloadDocument}</a>}</section>
          <section className="page-card" aria-labelledby="fields-title"><h2 className="page-title" id="fields-title">{copy.extractedFields}</h2><div className="review-fields">{fields.map((field) => { const confidence = payload?.invoice.confidenceData?.[field]; const low = confidence !== undefined && confidence < .8; return <div className="review-field" key={field}><label htmlFor={field}>{labels[field]}{low && <span className="confidence"> {copy.lowConfidence} ({Math.round(confidence * 100)}%)</span>}</label>{field === "notes" ? <textarea id={field} className={`page-textarea${low ? " low-confidence" : ""}`} value={values[field] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))} disabled={approved} /> : <input id={field} className={`page-input${low ? " low-confidence" : ""}`} value={values[field] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))} disabled={approved} />}</div>; })}
            {payload && headings && (
              <div className="review-coding">
                {!offered.some(usable) && !split && !lines[0]?.headingId ? (
                  <p className="page-empty">{copy.codingNoHeadings} <Link href={hrefFor(`/business/${businessId}/settings/workbook`)}>{copy.codingSetupLink}</Link></p>
                ) : !split ? (
                  <>
                    {codeSelect(lines[0], 0, copy.code)}
                    {suggested && <p className="coding-hint">{copy.codeSuggested}</p>}
                    {!approved && <button className="tertiary-button" type="button" onClick={startSplit}>{copy.splitCoding}</button>}
                  </>
                ) : (
                  <>
                    {lines.map((line, index) => (
                      <div className="coding-line" key={index}>
                        {codeSelect(line, index, fill(copy.codeLine, { n: index + 1 }))}
                        <div className="review-field">
                          <label htmlFor={`coding-amount-${index}`}>{fill(copy.amountLine, { n: index + 1 })}</label>
                          <input id={`coding-amount-${index}`} className="page-input" inputMode="decimal" value={line.amount} onChange={(event) => changeLine(index, { amount: event.target.value })} disabled={approved} />
                        </div>
                        {!approved && <button className="tertiary-button" type="button" aria-label={fill(copy.removeCodingLineLabel, { n: index + 1 })} onClick={() => removeLine(index)}>{copy.removeCodingLine}</button>}
                      </div>
                    ))}
                    <p className="coding-hint" aria-live="polite">{fill(copy.leftToAssign, { amount: leftPence === null ? "-" : formatPence(leftPence) })}</p>
                    {!approved && lines.length < MAX_LINES && <button className="tertiary-button" type="button" onClick={() => setLines((current) => [...current, { headingId: "", amount: "" }])}>{copy.addCodingLine}</button>}
                  </>
                )}
                {codingError && <p id="coding-error" className="page-error" role="alert">{codingError}</p>}
              </div>
            )}
          </div><div className="review-actions"><button className="primary-button" type="button" disabled={busy || approved} onClick={() => void save()}>{busy ? copy.saving : copy.save}</button><button className="secondary-button" type="button" disabled={busy || approved} onClick={() => void approve()}>{copy.approve}</button></div></section>
        </div>
      </div>
    </main>
  );
}
