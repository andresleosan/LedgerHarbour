"use client";

import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";

import { messages } from "@/i18n/config";
import type { AccountHeading, HeadingGroup } from "@/modules/accounting/heading-service";
import type { AccountSheet, TemplateDefect } from "@/modules/workbook/template-profile";
import { useUrlLocale } from "@/ui/useUrlLocale";

type Copy = typeof messages.en.workbookSettings;
type Template = { fileName: string; uploadedAt: string; sheets: AccountSheet[]; defects: TemplateDefect[] };
type ImportCounts = { inserted: number; updated: number; missing: number };
type HeadingChange = { displayName?: string; isActive?: boolean };
type ErrorPayload = { error?: { code?: string } };

const ACCEPTED_FILES = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const GROUPS: HeadingGroup[] = ["income", "cost_of_sales", "expenses", "assets", "liabilities", "equity"];

const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);
const plural = (forms: { one: string; other: string }, count: number) => count === 1 ? forms.one : forms.other;
const safeRows = (sheet: AccountSheet) => sheet.safeLastRow - sheet.firstDataRow + 1;

function uploadErrorFor(status: number, code: string | undefined, copy: Copy): string {
  if (status === 413 || code === "TOO_LARGE") return copy.tooLargeError;
  if (status === 415 || code === "NOT_A_WORKBOOK" || code === "EMPTY_TEMPLATE") return copy.notWorkbookError;
  if (code === "NO_ACCOUNT_SHEET" || code === "UNRECOGNISED_LAYOUT" || code === "INVALID_HEADINGS") return copy.notTemplateError;
  if (code === "INSUFFICIENT_CAPABILITY") return copy.accessError;
  if (code === "INACTIVE_BUSINESS") return copy.inactiveError;
  return copy.uploadError;
}

function headingErrorFor(code: string | undefined, copy: Copy): string {
  if (code === "INVALID_HEADING" || code === "INVALID_HEADING_REQUEST") return copy.invalidNameError;
  if (code === "HEADING_BLOCKED") return copy.blockedError;
  if (code === "HEADING_NOT_FOUND") return copy.notFoundError;
  if (code === "HEADING_REPOSITORY_CONFLICT") return copy.conflictError;
  if (code === "INSUFFICIENT_CAPABILITY") return copy.accessError;
  if (code === "INACTIVE_BUSINESS") return copy.inactiveError;
  return copy.headingError;
}

// One plain sentence per kind of defect that changes the result; spaces and numeric headings are handled by the app.
function adviceFor(template: Template, headings: AccountHeading[], copy: Copy, locale: string): string[] {
  const list = (items: string[]) => new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
  const defects = (code: TemplateDefect["code"]) => template.defects.filter((defect) => defect.code === code);
  const sheets = (code: TemplateDefect["code"]) => [...new Set(defects(code).flatMap((defect) => defect.sheet ? [defect.sheet] : []))];
  const advice: string[] = [];
  const broken = defects("BROKEN_REFERENCE").reduce((sum, defect) => sum + (defect.detail.cells ?? 0), 0);
  if (broken > 0) advice.push(fill(plural(copy.defects.brokenReference, broken), { count: broken }));
  const short = template.sheets.filter((sheet) => sheet.safeLastRow < sheet.lastDataRow);
  if (short.length > 0) advice.push(fill(copy.defects.truncatedColumn, { sheets: list(short.map((sheet) => fill(copy.defects.sheetRows, { name: sheet.name, rows: safeRows(sheet) }))) }));
  const stale = sheets("STALE_CLOSING_BALANCE");
  if (stale.length > 0) advice.push(fill(copy.defects.staleClosingBalance, { sheets: list(stale) }));
  const unconsolidated = sheets("UNCONSOLIDATED_SHEET");
  if (unconsolidated.length > 0) advice.push(fill(plural(copy.defects.unconsolidatedSheet, unconsolidated.length), { sheets: list(unconsolidated) }));
  const positions = new Set([...defects("HEADING_TOTAL_NOT_READ"), ...defects("HEADING_TOTAL_READ_TWICE")].map((defect) => defect.position));
  const unusable = headings.filter((heading) => positions.has(heading.position)).map((heading) => heading.displayName);
  if (unusable.length > 0) advice.push(fill(plural(copy.defects.headingTotal, unusable.length), { headings: list(unusable) }));
  const blank = defects("BLANK_HEADING").length;
  if (blank > 0) advice.push(fill(plural(copy.defects.blankHeading, blank), { count: blank }));
  return advice;
}

export default function WorkbookSettingsPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = use(params);
  const { locale, hrefFor } = useUrlLocale();
  const [template, setTemplate] = useState<Template | null>(null);
  const [headings, setHeadings] = useState<AccountHeading[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [counts, setCounts] = useState<ImportCounts | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const copy = messages[locale].workbookSettings;

  const load = async () => {
    try {
      const [templateResponse, headingsResponse] = await Promise.all([fetch(`/api/businesses/${businessId}/template`), fetch(`/api/businesses/${businessId}/headings`)]);
      if (!templateResponse.ok || !headingsResponse.ok) throw new Error();
      setTemplate(await templateResponse.json() as Template | null);
      setHeadings(await headingsResponse.json() as AccountHeading[]);
      setLoadError(null);
    } catch {
      setLoadError(copy.loadError);
    }
  };

  useEffect(() => { void load(); }, [businessId]);

  const chooseFile = () => {
    if (template && !window.confirm(copy.confirmReplace)) return;
    fileInputRef.current?.click();
  };

  const upload = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setUploading(true); setUploadError(null); setCounts(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`/api/businesses/${businessId}/template`, { method: "POST", body });
      const payload = await response.json().catch(() => ({})) as ImportCounts & ErrorPayload;
      if (!response.ok) {
        if (response.status === 403) setReadOnly(true);
        setUploadError(uploadErrorFor(response.status, payload.error?.code, copy));
        return;
      }
      setCounts({ inserted: payload.inserted, updated: payload.updated, missing: payload.missing });
      await load();
    } catch {
      setUploadError(copy.uploadError);
    } finally {
      setUploading(false);
    }
  };

  const setRowError = (id: string, message: string) => setRowErrors((current) => ({ ...current, [id]: message }));

  const save = async (heading: AccountHeading, change: HeadingChange) => {
    if (change.displayName !== undefined) {
      const name = change.displayName.trim();
      if (!name || name.length > 100) { setRowError(heading.id, copy.invalidNameError); return; }
      if (name === heading.displayName) { setEditing(null); setRowError(heading.id, ""); return; }
      change = { displayName: name };
    }
    setBusyId(heading.id); setRowError(heading.id, "");
    try {
      const response = await fetch(`/api/businesses/${businessId}/headings/${heading.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) });
      const payload = await response.json() as AccountHeading & ErrorPayload;
      if (!response.ok) {
        if (response.status === 403) setReadOnly(true);
        setRowError(heading.id, headingErrorFor(payload.error?.code, copy));
        return;
      }
      setHeadings((current) => current.map((item) => item.id === payload.id ? payload : item));
      if (change.displayName !== undefined) setEditing(null);
    } catch {
      setRowError(heading.id, headingErrorFor(undefined, copy));
    } finally {
      setBusyId(null);
    }
  };

  const cancelEdit = (heading: AccountHeading) => { setEditing(null); setRowError(heading.id, ""); };

  const renderHeading = (heading: AccountHeading) => {
    const nameId = `heading-${heading.id}-name`;
    const inputId = `heading-${heading.id}-input`;
    const errorId = `heading-${heading.id}-error`;
    const error = rowErrors[heading.id];
    const busy = busyId === heading.id;
    const trailing = heading.templateValue.length - heading.templateValue.trimEnd().length;
    const state = heading.blockedReason ? copy.blocked[heading.blockedReason] : heading.isActive ? copy.active : copy.inactive;
    return (
      <article className="settings-item" key={heading.id} aria-labelledby={nameId}>
        <div>
          <strong id={nameId}>{heading.displayName}</strong>
          {heading.templateValue !== heading.displayName && (
            <small>
              {fill(copy.templateLabel, { value: heading.templateValue.trim() ? heading.templateValue.trimEnd() : copy.emptyValue })}
              {heading.templateValue.trim() && trailing > 0 && <><span aria-hidden="true">{"·".repeat(trailing)}</span><span className="sr-only"> {copy.trailingSpace}</span></>}
            </small>
          )}
          <small>{state}</small>
          {editing?.id === heading.id && (
            <form className="workbook-rename" onSubmit={(event) => { event.preventDefault(); void save(heading, { displayName: editing.name }); }}>
              <label className="sr-only" htmlFor={inputId}>{fill(copy.newName, { name: heading.displayName })}</label>
              <input className="page-input" id={inputId} value={editing.name} maxLength={100} autoFocus disabled={busy} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} onChange={(event) => setEditing({ id: heading.id, name: event.target.value })} onKeyDown={(event) => { if (event.key === "Escape") cancelEdit(heading); }} />
              <div className="page-actions"><button className="primary-button" type="submit" disabled={busy}>{copy.save}</button><button className="tertiary-button" type="button" disabled={busy} onClick={() => cancelEdit(heading)}>{copy.cancel}</button></div>
            </form>
          )}
          {error && <p id={errorId} className="page-error" role="alert">{error}</p>}
        </div>
        {!readOnly && editing?.id !== heading.id && (
          <div className="page-actions">
            <button className="tertiary-button" type="button" disabled={busy} aria-describedby={error ? errorId : undefined} onClick={() => { setEditing({ id: heading.id, name: heading.displayName }); setRowError(heading.id, ""); }}>{copy.rename}</button>
            {!heading.blockedReason && <button className="secondary-button" type="button" disabled={busy} aria-describedby={error ? errorId : undefined} onClick={() => void save(heading, { isActive: !heading.isActive })}>{heading.isActive ? copy.deactivate : copy.activate}</button>}
          </div>
        )}
      </article>
    );
  };

  const advice = template ? adviceFor(template, headings, copy, locale) : [];

  return (
    <main className="operational-page settings-page">
      <div className="page-shell settings-shell workbook-shell">
        <Link className="page-back" href={hrefFor(`/business/${businessId}/invoices`)}>{copy.brand} / {copy.title}</Link>
        <section className="page-card" aria-labelledby="workbook-title">
          <p className="page-eyebrow">{copy.eyebrow}</p>
          <h1 className="page-title" id="workbook-title">{copy.title}</h1>
          <p className="page-description">{copy.description}</p>
          {loadError && <p className="page-error" role="alert">{loadError}</p>}
        </section>

        <section className="page-card" aria-labelledby="template-title">
          <h2 id="template-title">{copy.templateTitle}</h2>
          {template ? <p>{fill(copy.templateCurrent, { name: template.fileName, date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(template.uploadedAt)) })}</p> : <p className="page-empty">{copy.templateEmpty}</p>}
          {!readOnly && (
            <div className="page-actions">
              <input ref={fileInputRef} hidden aria-label={copy.fileLabel} type="file" accept={ACCEPTED_FILES} onChange={(event) => void upload(event.currentTarget)} />
              <button className="primary-button" type="button" disabled={uploading} aria-describedby={uploadError ? "template-error" : undefined} onClick={chooseFile}>{template ? copy.replace : copy.upload}</button>
            </div>
          )}
          <p className="page-feedback" role="status" aria-live="polite">{uploading ? copy.uploading : counts ? copy.uploaded : ""}</p>
          {uploadError && <p id="template-error" className="page-error" role="alert">{uploadError}</p>}
          {counts && <p>{fill(copy.headingCounts, counts)}</p>}
          {template && (
            <>
              <p>{fill(plural(copy.sheetsRead, template.sheets.length), { count: template.sheets.length })}</p>
              <ul className="workbook-list">{template.sheets.map((sheet) => <li key={sheet.name}>{fill(copy.sheetRoom, { name: sheet.name, rows: safeRows(sheet) })}</li>)}</ul>
            </>
          )}
        </section>

        {template && (
          <section className="page-card" aria-labelledby="advice-title">
            <h2 id="advice-title">{copy.adviceTitle}</h2>
            {advice.length === 0 ? <p>{copy.adviceNone}</p> : (
              <>
                <p className="page-description">{copy.adviceIntro}</p>
                <ul className="workbook-list">{advice.map((sentence) => <li key={sentence}>{sentence}</li>)}</ul>
              </>
            )}
          </section>
        )}

        <section className="page-card" aria-labelledby="chart-title">
          <h2 id="chart-title">{copy.chartTitle}</h2>
          {headings.length === 0 ? <p className="page-empty">{copy.chartEmpty}</p> : (
            <>
              <p className="page-description">{copy.chartHint}</p>
              {GROUPS.map((group, index) => {
                const items = headings.filter((heading) => heading.group === group);
                return items.length === 0 ? null : (
                  <details className="workbook-group" key={group} open={index < 2}>
                    <summary>{copy.groups[group]} ({items.length})</summary>
                    <div className="settings-items">{items.map(renderHeading)}</div>
                  </details>
                );
              })}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
