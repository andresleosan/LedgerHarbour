"use client";

import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";

import { messages } from "@/i18n/config";
import type { AccountHeading, HeadingGroup } from "@/modules/accounting/heading-service";
import { formatPence, parsePounds } from "@/modules/accounting/money";
import type { FinancialYear } from "@/modules/accounting/money-repository";
import type { MoneyAccountWithOpening } from "@/modules/accounting/money-service";
import { STATEMENT_MAX_BYTES, type DateFormat, type StatementMapping } from "@/modules/accounting/statement-csv";
import type { StatementPreview, TrayMovement } from "@/modules/accounting/statement-import-service";
import { useUrlLocale } from "@/ui/useUrlLocale";

type Columns = { kind: "single" | "pair"; date: string; description: string; amount: string; moneyIn: string; moneyOut: string; reference?: number };
type Result = { ok: true; body: unknown } | { ok: false; code?: string };

const GROUPS: HeadingGroup[] = ["income", "cost_of_sales", "expenses", "assets", "liabilities", "equity"];
const PAGE = 50;
const noColumns: Columns = { kind: "single", date: "", description: "", amount: "", moneyIn: "", moneyOut: "" };

const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);
const pick = <T extends Record<string, string>>(table: T, code: string | undefined, fallback: string) => code && code in table ? table[code as keyof T] : fallback;
const usable = (heading: AccountHeading) => heading.isActive && heading.blockedReason === null;

function columnsFrom(mapping: StatementMapping | null): Columns {
  if (!mapping) return noColumns;
  const base = { date: String(mapping.date), description: String(mapping.description), reference: mapping.reference };
  return "amount" in mapping
    ? { ...noColumns, ...base, kind: "single", amount: String(mapping.amount) }
    : { ...noColumns, ...base, kind: "pair", moneyIn: String(mapping.moneyIn), moneyOut: String(mapping.moneyOut) };
}

function mappingFrom(columns: Columns): StatementMapping | null {
  const needed = columns.kind === "single" ? [columns.date, columns.description, columns.amount] : [columns.date, columns.description, columns.moneyIn, columns.moneyOut];
  if (needed.some((value) => value === "")) return null;
  const base = { date: Number(columns.date), description: Number(columns.description), ...(columns.reference === undefined ? {} : { reference: columns.reference }) };
  return columns.kind === "single" ? { ...base, amount: Number(columns.amount) } : { ...base, moneyIn: Number(columns.moneyIn), moneyOut: Number(columns.moneyOut) };
}

export default function StatementImportPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = use(params);
  const { locale, hrefFor } = useUrlLocale();
  const copy = messages[locale].statementImport;
  const movementCopy = messages[locale].movements;
  const groupLabels = messages[locale].workbookSettings.groups;
  const api = `/api/businesses/${businessId}`;
  const fileInput = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [year, setYear] = useState<FinancialYear | null>(null);
  const [accounts, setAccounts] = useState<MoneyAccountWithOpening[]>([]);
  const [headings, setHeadings] = useState<AccountHeading[]>([]);
  const [accountId, setAccountId] = useState("");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [columns, setColumns] = useState<Columns>(noColumns);
  const [dateFormat, setDateFormat] = useState<DateFormat | "">("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState("");
  const [tray, setTray] = useState<TrayMovement[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [trayStatus, setTrayStatus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE);

  const send = async (url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<Result> => {
    try {
      const response = await fetch(url, body === undefined ? { method } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({})) as { error?: { code?: string } };
      if (response.ok) return { ok: true, body: payload };
      if (response.status === 403) setReadOnly(true);
      return { ok: false, code: payload.error?.code };
    } catch {
      return { ok: false };
    }
  };

  const loadTray = async (yearId: string) => {
    const response = await fetch(`${api}/statement-imports/tray?yearId=${encodeURIComponent(yearId)}`);
    if (!response.ok) throw new Error();
    const rows = await response.json() as TrayMovement[];
    setTray(rows);
    setChoices(Object.fromEntries(rows.map((row) => [row.id, row.suggestedHeadingId ?? ""])));
  };

  const load = async () => {
    try {
      const yearsResponse = await fetch(`${api}/financial-years`);
      if (!yearsResponse.ok) throw new Error();
      const open = (await yearsResponse.json() as FinancialYear[]).find((item) => item.status === "open") ?? null;
      if (open) {
        const responses = await Promise.all([fetch(`${api}/money-accounts?yearId=${encodeURIComponent(open.id)}`), fetch(`${api}/headings`)]);
        if (responses.some((response) => !response.ok)) throw new Error();
        const [loadedAccounts, loadedHeadings] = await Promise.all(responses.map((response) => response.json())) as [MoneyAccountWithOpening[], AccountHeading[]];
        const active = loadedAccounts.filter((account) => account.isActive);
        setAccounts(active);
        setHeadings(loadedHeadings);
        setAccountId((current) => active.some((account) => account.id === current) ? current : active[0]?.id ?? "");
        await loadTray(open.id);
      }
      setYear(open);
      setLoadError(null);
      setLoaded(true);
    } catch {
      setLoadError(copy.loadError);
    }
  };

  useEffect(() => { void load(); }, [businessId]);

  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  const pounds = (pence: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "GBP", currencyDisplay: "narrowSymbol" }).format(formatPence(pence) as `${number}`);
  const signed = (pence: number) => fill(pence < 0 ? movementCopy.amountOut : movementCopy.amountIn, { amount: pounds(Math.abs(pence)) });

  const runPreview = async (text: string, target: { accountId: string; columns?: Columns; dateFormat?: DateFormat | "" }) => {
    const mapping = target.columns ? mappingFrom(target.columns) : null;
    const format = target.dateFormat || undefined;
    setBusy("preview"); setFileError(null); setImportStatus("");
    const result = await send(`${api}/statement-imports/preview`, "POST", { accountId: target.accountId, csv: text, ...(mapping ? { mapping } : {}), ...(format ? { dateFormat: format } : {}) });
    if (result.ok) {
      const body = result.body as StatementPreview;
      setPreview(body);
      setColumns(mapping ? target.columns! : columnsFrom(body.mapping));
      setDateFormat(body.dateFormat ?? format ?? "");
    } else {
      setPreview(null);
      setFileError(pick(copy.fileErrors, result.code, copy.requestError));
    }
    setBusy(null);
  };

  const chooseFile = async (chosen: File | undefined) => {
    if (fileInput.current) fileInput.current.value = "";
    if (!chosen) return;
    setPreview(null); setColumns(noColumns); setDateFormat(""); setTrayStatus("");
    if (chosen.size > STATEMENT_MAX_BYTES) {
      setFile(null);
      setFileError(copy.fileErrors.TOO_LARGE);
      return;
    }
    const text = await chosen.text();
    setFile({ name: chosen.name, text });
    await runPreview(text, { accountId });
  };

  const changeColumns = (patch: Partial<Columns>) => {
    const next = { ...columns, ...patch };
    setColumns(next);
    if (file && mappingFrom(next)) void runPreview(file.text, { accountId, columns: next, dateFormat });
  };

  const changeAccount = (value: string) => {
    setAccountId(value);
    if (file && value) void runPreview(file.text, { accountId: value, columns: mappingFrom(columns) ? columns : undefined, dateFormat });
  };

  const changeDateFormat = (value: DateFormat | "") => {
    setDateFormat(value);
    if (file && value) void runPreview(file.text, { accountId, columns: mappingFrom(columns) ? columns : undefined, dateFormat: value });
  };

  const blocked = !preview ? null
    : !mappingFrom(columns) || !preview.mapping ? copy.blocked.columns
    : preview.needsDateFormat ? copy.blocked.dateFormat
    : preview.errors.length > 0 ? copy.blocked.errors
    : preview.counts.toImport === 0 ? copy.blocked.nothing
    : null;

  const runImport = async () => {
    if (!file || !preview || blocked || !year) return;
    const mapping = mappingFrom(columns);
    setBusy("import"); setFileError(null); setImportStatus(""); setTrayStatus("");
    const result = await send(`${api}/statement-imports`, "POST", { accountId, csv: file.text, ...(mapping ? { mapping } : {}), ...(dateFormat ? { dateFormat } : {}) });
    if (result.ok) {
      setImportStatus(fill(copy.imported, { count: (result.body as { imported: number }).imported }));
      setFile(null); setPreview(null); setColumns(noColumns); setDateFormat("");
      await loadTray(year.id).catch(() => setLoadError(copy.loadError));
    } else {
      setFileError(pick(copy.fileErrors, result.code, copy.requestError));
    }
    setBusy(null);
  };

  const saveCode = async (row: TrayMovement, headingId: string): Promise<boolean> => {
    if (!headingId) { setRowErrors((current) => ({ ...current, [row.id]: copy.trayErrors.chooseCode })); return false; }
    const result = await send(`${api}/statement-imports/tray/${row.id}`, "PATCH", { headingId });
    if (!result.ok) setRowErrors((current) => ({ ...current, [row.id]: pick(copy.trayErrors, result.code, copy.saveError) }));
    return result.ok;
  };

  const trayAction = async (key: string, action: () => Promise<string | null>) => {
    if (!year) return;
    setBusy(key); setRowErrors({}); setTrayStatus(""); setImportStatus("");
    const status = await action();
    await loadTray(year.id).catch(() => setLoadError(copy.loadError));
    if (status) setTrayStatus(status);
    setBusy(null);
  };

  const saveOne = (row: TrayMovement) => trayAction(row.id, async () => (await saveCode(row, choices[row.id] ?? "")) ? copy.codeSaved : null);
  const saveAllSuggested = () => trayAction("all", async () => {
    let saved = 0;
    for (const row of tray) if (row.suggestedHeadingId && await saveCode(row, row.suggestedHeadingId)) saved++;
    return fill(copy.allSaved, { count: saved });
  });
  const remove = (row: TrayMovement) => {
    if (!window.confirm(copy.confirmDelete)) return;
    void trayAction(row.id, async () => {
      const result = await send(`${api}/statement-imports/tray/${row.id}`, "DELETE");
      if (!result.ok) setRowErrors({ [row.id]: pick(copy.trayErrors, result.code, copy.saveError) });
      return result.ok ? copy.deleted : null;
    });
  };

  const headers = preview?.headers ?? [];
  const columnSelect = (name: "date" | "description" | "amount" | "moneyIn" | "moneyOut", label: string) => (
    <div className="money-field">
      <label htmlFor={`statement-${name}`}>{label}</label>
      <select className="page-input" id={`statement-${name}`} value={columns[name]} disabled={busy !== null} onChange={(event) => changeColumns({ [name]: event.target.value, ...(name === "description" ? { reference: undefined } : {}) })}>
        <option value="">{copy.chooseColumn}</option>
        {headers.map((header, index) => <option key={index} value={String(index)}>{header || `#${index + 1}`}</option>)}
      </select>
    </div>
  );

  const ready = year !== null && accounts.length > 0;
  const offered = headings.filter(usable);
  const shownTray = tray.slice(0, visible);
  const skipped = preview ? preview.counts.skipped.zero + preview.counts.skipped.notSterling + preview.counts.skipped.notCompleted : 0;

  return (
    <main className="operational-page settings-page">
      <div className="page-shell settings-shell money-shell">
        <Link className="page-back" href={hrefFor(`/business/${businessId}/movements`)}>{copy.back} / {copy.title}</Link>
        <section className="page-card" aria-labelledby="statement-title">
          <p className="page-eyebrow">{copy.eyebrow}</p>
          <h1 className="page-title" id="statement-title">{copy.title}</h1>
          <p className="page-description">{copy.description}</p>
          {readOnly && <p className="page-empty">{copy.readOnly}</p>}
          {loadError && <p className="page-error" role="alert">{loadError}</p>}
          {loaded && !ready && <p className="page-empty">{copy.notReady} <Link className="money-link" href={hrefFor(`/business/${businessId}/settings/accounts`)}>{copy.notReadyLink}</Link></p>}
        </section>

        {loaded && ready && !readOnly && (
          <section className="page-card" aria-labelledby="statement-file-title">
            <h2 id="statement-file-title">{copy.stepFile}</h2>
            <div className="money-form">
              <div className="money-field">
                <label htmlFor="statement-account">{copy.account}</label>
                <select className="page-input" id="statement-account" value={accountId} disabled={busy !== null} onChange={(event) => changeAccount(event.target.value)}>
                  <option value="">{copy.chooseAccount}</option>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </div>
              <div className="money-field">
                <label htmlFor="statement-file">{copy.fileLabel}</label>
                <input ref={fileInput} className="sr-only" id="statement-file" type="file" accept=".csv,text/csv" tabIndex={-1} disabled={busy !== null || !accountId} onChange={(event) => void chooseFile(event.target.files?.[0])} />
                <p className="money-hint" id="statement-file-help">{copy.fileHelp}</p>
                <div className="page-actions">
                  <button className="tertiary-button" type="button" aria-describedby="statement-file-help" disabled={busy !== null || !accountId} onClick={() => fileInput.current?.click()}>{copy.chooseFile}</button>
                </div>
                {file && <p className="money-hint">{fill(copy.fileChosen, { name: file.name })}</p>}
              </div>
            </div>
            {fileError && <p className="page-error" role="alert">{fileError}</p>}
            <p className="page-feedback" role="status" aria-live="polite">{busy === "preview" ? copy.reading : importStatus}</p>
          </section>
        )}

        {loaded && ready && !readOnly && preview && file && (
          <section className="page-card" aria-labelledby="statement-preview-title">
            <h2 id="statement-preview-title">{copy.stepPreview}</h2>
            <p className="money-hint">{preview.mapping ? copy.columnsHelp : copy.columnsNeeded}</p>
            <div className="money-form">
              <div className="money-dates">
                {columnSelect("date", copy.dateColumn)}
                {columnSelect("description", copy.descriptionColumn)}
              </div>
              <div className="money-field">
                <label htmlFor="statement-amount-kind">{copy.amountKind}</label>
                <select className="page-input" id="statement-amount-kind" value={columns.kind} disabled={busy !== null} onChange={(event) => changeColumns({ kind: event.target.value as Columns["kind"], amount: "", moneyIn: "", moneyOut: "" })}>
                  <option value="single">{copy.amountKinds.single}</option>
                  <option value="pair">{copy.amountKinds.pair}</option>
                </select>
              </div>
              {columns.kind === "single"
                ? columnSelect("amount", copy.amountColumn)
                : <div className="money-dates">{columnSelect("moneyIn", copy.moneyInColumn)}{columnSelect("moneyOut", copy.moneyOutColumn)}</div>}
              {(preview.needsDateFormat || preview.dateFormat !== null) && (
                <div className="money-field">
                  <label htmlFor="statement-date-format">{copy.dateFormat}</label>
                  <select className="page-input" id="statement-date-format" value={dateFormat} disabled={busy !== null} aria-describedby={preview.needsDateFormat ? "statement-date-format-hint" : undefined} onChange={(event) => changeDateFormat(event.target.value as DateFormat | "")}>
                    <option value="">{copy.chooseDateFormat}</option>
                    <option value="day_first">{copy.dateFormats.day_first}</option>
                    <option value="month_first">{copy.dateFormats.month_first}</option>
                  </select>
                  {preview.needsDateFormat && <p className="money-hint" id="statement-date-format-hint">{copy.dateFormatNeeded}</p>}
                </div>
              )}
            </div>

            {preview.rows.length > 0 && (
              <>
                <h3>{copy.firstLines}</h3>
                <ul className="settings-items movement-list">
                  {preview.rows.map((row) => (
                    <li className="settings-item movement-row" key={row.line}>
                      <div>
                        <strong>{row.description || copy.noDescription}</strong>
                        <small>{date(row.date)}</small>
                        <small><span className="movement-origin">{copy.outcomes[row.outcome]}</span></small>
                      </div>
                      <div className="movement-side"><span className="movement-amount">{signed(row.amountPence)}</span></div>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h3>{copy.summaryTitle}</h3>
            <ul>
              <li>{fill(copy.summary.new, { count: preview.counts.toImport })}</li>
              <li>{fill(copy.summary.alreadyImported, { count: preview.counts.alreadyImported })}</li>
              <li>{fill(copy.summary.alreadyRecorded, { count: preview.counts.alreadyRecorded })}</li>
              <li>{fill(copy.summary.skipped, { count: skipped, ...preview.counts.skipped })}</li>
            </ul>

            {preview.errors.length > 0 && (
              <div role="alert">
                <h3>{copy.errorsTitle}</h3>
                <ul>
                  {preview.errors.map((error) => <li key={`${error.line}-${error.reason}`}>{fill(copy.errorLine, { line: error.line, reason: copy.reasons[error.reason] })}</li>)}
                </ul>
                <p className="page-error">{copy.nothingImported}</p>
              </div>
            )}

            <div className="page-actions">
              <button className="primary-button" type="button" disabled={busy !== null || blocked !== null} aria-describedby={blocked ? "statement-blocked" : undefined} onClick={() => void runImport()}>
                {preview.counts.toImport === 1 ? copy.importOne : fill(copy.importButton, { count: preview.counts.toImport })}
              </button>
              {blocked && <p className="money-hint" id="statement-blocked">{blocked}</p>}
            </div>
          </section>
        )}

        {loaded && ready && (
          <section className="page-card" aria-labelledby="statement-tray-title">
            <h2 id="statement-tray-title">{copy.trayTitle}</h2>
            <p className="money-hint">{copy.trayHelp}</p>
            {tray.length === 0 ? <p className="page-empty">{copy.trayEmpty}</p> : (
              <>
                {!readOnly && tray.some((row) => row.suggestedHeadingId) && (
                  <div className="page-actions">
                    <button className="tertiary-button" type="button" disabled={busy !== null} onClick={() => void saveAllSuggested()}>{copy.saveAllSuggested}</button>
                  </div>
                )}
                <ul className="settings-items movement-list">
                  {shownTray.map((row) => {
                    const pence = parsePounds(row.amount);
                    const errorId = `tray-${row.id}-error`;
                    const hintId = `tray-${row.id}-hint`;
                    const suggested = row.suggestedHeadingId !== null && choices[row.id] === row.suggestedHeadingId;
                    return (
                      <li className="settings-item movement-row" key={row.id}>
                        <div>
                          <strong>{row.narrative}</strong>
                          <small>{date(row.movementDate)}</small>
                          {!readOnly && (
                            <div className="money-field">
                              <label htmlFor={`tray-${row.id}`}>{copy.code}</label>
                              <select className="page-input" id={`tray-${row.id}`} value={choices[row.id] ?? ""} disabled={busy !== null}
                                aria-invalid={rowErrors[row.id] ? true : undefined}
                                aria-describedby={[suggested ? hintId : "", rowErrors[row.id] ? errorId : ""].filter(Boolean).join(" ") || undefined}
                                onChange={(event) => setChoices((current) => ({ ...current, [row.id]: event.target.value }))}>
                                <option value="">{copy.chooseCode}</option>
                                {GROUPS.map((group) => {
                                  const items = offered.filter((heading) => heading.group === group);
                                  return items.length === 0 ? null : <optgroup key={group} label={groupLabels[group]}>{items.map((heading) => <option key={heading.id} value={heading.id}>{heading.displayName}</option>)}</optgroup>;
                                })}
                              </select>
                              {suggested && <p className="money-hint" id={hintId}><span className="movement-origin">{copy.suggested}</span></p>}
                            </div>
                          )}
                          {rowErrors[row.id] && <p id={errorId} className="page-error" role="alert">{rowErrors[row.id]}</p>}
                        </div>
                        <div className="movement-side">
                          <span className="movement-amount">{signed(pence)}</span>
                          {!readOnly && (
                            <div className="page-actions">
                              <button className="primary-button" type="button" disabled={busy !== null} onClick={() => void saveOne(row)}>{copy.save}<span className="sr-only"> {row.narrative}, {signed(pence)}</span></button>
                              <button className="secondary-button" type="button" disabled={busy !== null} onClick={() => remove(row)}>{copy.delete}<span className="sr-only"> {row.narrative}, {signed(pence)}</span></button>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {tray.length > shownTray.length && (
                  <div className="page-actions">
                    <p className="money-hint">{fill(copy.showing, { shown: shownTray.length, total: tray.length })}</p>
                    <button className="tertiary-button" type="button" onClick={() => setVisible((current) => current + PAGE)}>{copy.showMore}</button>
                  </div>
                )}
              </>
            )}
            <p className="page-feedback" role="status" aria-live="polite">{trayStatus}</p>
          </section>
        )}
      </div>
    </main>
  );
}
