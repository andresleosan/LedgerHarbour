"use client";

import Link from "next/link";
import { use, useEffect, useState, type KeyboardEvent } from "react";

import { messages } from "@/i18n/config";
import { formatPence, parsePounds } from "@/modules/accounting/money";
import type { FinancialYear, MoneyAccount, MoneyAccountKind } from "@/modules/accounting/money-repository";
import type { MoneyAccountWithOpening } from "@/modules/accounting/money-service";
import type { AccountSheet } from "@/modules/workbook/template-profile";
import { useUrlLocale } from "@/ui/useUrlLocale";

type Copy = typeof messages.en.moneySettings;
type Dates = { startDate: string; endDate: string };
type ErrorPayload = { error?: { code?: string } };
type Result<T> = { ok: true; data: T } | { ok: false; message: string };

const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);
const errorFor = (code: string | undefined, copy: Copy) => code && code in copy.errors ? copy.errors[code as keyof Copy["errors"]] : copy.saveError;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const calendarYear = (): Dates => ({ startDate: `${new Date().getFullYear()}-01-01`, endDate: `${new Date().getFullYear()}-12-31` });

// The day after the last year ends, one year long.
function nextYearDates(previous: FinancialYear): Dates {
  const start = new Date(`${previous.endDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + 1);
  return { startDate: isoDay(start), endDate: isoDay(new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate() - 1))) };
}

export default function MoneySettingsPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = use(params);
  const { locale, hrefFor } = useUrlLocale();
  const copy = messages[locale].moneySettings;
  const api = `/api/businesses/${businessId}`;
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [years, setYears] = useState<FinancialYear[]>([]);
  const [sheets, setSheets] = useState<AccountSheet[] | null>(null);
  const [accounts, setAccounts] = useState<MoneyAccountWithOpening[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [yearForm, setYearForm] = useState<Dates>(calendarYear);
  const [editingYear, setEditingYear] = useState<(Dates & { id: string }) | null>(null);
  const [yearStatus, setYearStatus] = useState("");
  const [yearError, setYearError] = useState<{ key: string; message: string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [opening, setOpening] = useState<{ id: string; amount: string } | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [accountStatus, setAccountStatus] = useState("");
  const [newAccount, setNewAccount] = useState<{ name: string; kind: MoneyAccountKind; sheetName: string }>({ name: "", kind: "bank", sheetName: "" });
  const [addError, setAddError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [yearsResponse, templateResponse] = await Promise.all([fetch(`${api}/financial-years`), fetch(`${api}/template`)]);
      if (!yearsResponse.ok || !templateResponse.ok) throw new Error();
      const loadedYears = await yearsResponse.json() as FinancialYear[];
      const open = loadedYears.find((year) => year.status === "open");
      const accountsResponse = await fetch(`${api}/money-accounts${open ? `?yearId=${encodeURIComponent(open.id)}` : ""}`);
      if (!accountsResponse.ok) throw new Error();
      const template = await templateResponse.json() as { sheets: AccountSheet[] } | null;
      setYears(loadedYears);
      setSheets(template?.sheets ?? null);
      setAccounts(await accountsResponse.json() as MoneyAccountWithOpening[]);
      const latest = loadedYears[loadedYears.length - 1];
      setYearForm(latest ? nextYearDates(latest) : calendarYear());
      setLoadError(null);
      setLoaded(true);
    } catch {
      setLoadError(copy.loadError);
    }
  };

  useEffect(() => { void load(); }, [businessId]);

  const send = async <T,>(url: string, method: "POST" | "PATCH", body: unknown): Promise<Result<T>> => {
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({})) as T & ErrorPayload;
      if (!response.ok) {
        if (response.status === 403) setReadOnly(true);
        return { ok: false, message: errorFor(payload.error?.code, copy) };
      }
      return { ok: true, data: payload };
    } catch {
      return { ok: false, message: copy.saveError };
    }
  };

  const openYear = years.find((year) => year.status === "open");
  const recentFirst = [...years].reverse();
  const currentYear = openYear ?? recentFirst[0];
  const pastYears = recentFirst.filter((year) => year !== currentYear);
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  const pounds = (amount: string) => new Intl.NumberFormat(locale, { style: "currency", currency: "GBP", currencyDisplay: "narrowSymbol" }).format(amount as `${number}`);

  // Every year change reloads everything: the open year decides which opening balances are shown.
  const changeYear = async (key: string, request: Promise<Result<FinancialYear>>, done: string) => {
    setBusy(key); setYearError(null); setYearStatus("");
    const result = await request;
    if (result.ok) {
      setEditingYear(null);
      await load();
      setYearStatus(done);
    } else {
      setYearError({ key, message: result.message });
    }
    setBusy(null);
  };

  const submitDates = (key: string, dates: Dates, yearId?: string) => {
    if (!dates.startDate || !dates.endDate || dates.endDate <= dates.startDate) { setYearError({ key, message: copy.errors.INVALID_FINANCIAL_YEAR }); return; }
    const body = { startDate: dates.startDate, endDate: dates.endDate };
    void changeYear(key, yearId ? send<FinancialYear>(`${api}/financial-years/${yearId}`, "PATCH", body) : send<FinancialYear>(`${api}/financial-years`, "POST", body), yearId ? copy.datesSaved : copy.yearCreated);
  };

  const setStatus = (year: FinancialYear, status: "open" | "closed") => {
    if (status === "closed" && !window.confirm(copy.confirmClose)) return;
    void changeYear(year.id, send<FinancialYear>(`${api}/financial-years/${year.id}`, "PATCH", { status }), status === "closed" ? copy.yearClosed : copy.yearReopened);
  };

  const renderDates = (key: string, dates: Dates, onChange: (dates: Dates) => void, onCancel?: () => void) => {
    const errorId = `year-${key}-error`;
    const invalid = yearError?.key === key;
    const field = (name: keyof Dates, label: string) => (
      <div className="money-field">
        <label htmlFor={`year-${key}-${name}`}>{label}</label>
        <input className="page-input" id={`year-${key}-${name}`} type="date" required value={dates[name]} disabled={busy === key} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} onChange={(event) => onChange({ ...dates, [name]: event.target.value })} onKeyDown={(event) => { if (event.key === "Escape" && onCancel) onCancel(); }} />
      </div>
    );
    return (
      <form className="money-form" noValidate onSubmit={(event) => { event.preventDefault(); submitDates(key, dates, onCancel ? key : undefined); }}>
        <div className="money-dates">{field("startDate", copy.startDate)}{field("endDate", copy.endDate)}</div>
        <div className="page-actions">
          <button className="primary-button" type="submit" disabled={busy === key} aria-describedby={invalid ? errorId : undefined}>{onCancel ? copy.saveDates : years.length === 0 ? copy.createYear : copy.startNextYear}</button>
          {onCancel && <button className="tertiary-button" type="button" disabled={busy === key} onClick={onCancel}>{copy.cancel}</button>}
        </div>
        {invalid && <p id={errorId} className="page-error" role="alert">{yearError?.message}</p>}
      </form>
    );
  };

  const renderYear = (year: FinancialYear) => {
    const nameId = `year-${year.id}-name`;
    const errorId = `year-${year.id}-error`;
    const editing = editingYear?.id === year.id;
    const failed = yearError?.key === year.id;
    const cancel = () => { setEditingYear(null); setYearError(null); };
    return (
      <article className="settings-item" key={year.id} aria-labelledby={nameId}>
        <div>
          <strong id={nameId}>{fill(copy.range, { start: date(year.startDate), end: date(year.endDate) })}</strong>
          <small>{year.status === "open" ? copy.open : copy.closed}</small>
          {editing && renderDates(year.id, editingYear, (dates) => setEditingYear({ ...dates, id: year.id }), cancel)}
          {failed && !editing && <p id={errorId} className="page-error" role="alert">{yearError?.message}</p>}
        </div>
        {!readOnly && !editing && (
          <div className="page-actions">
            <button className="tertiary-button" type="button" disabled={busy === year.id} aria-describedby={failed ? errorId : undefined} onClick={() => { setEditingYear({ id: year.id, startDate: year.startDate, endDate: year.endDate }); setYearError(null); }}>{copy.changeDates}</button>
            {year.status === "open" && <button className="secondary-button" type="button" disabled={busy === year.id} aria-describedby={failed ? errorId : undefined} onClick={() => setStatus(year, "closed")}>{copy.closeYear}</button>}
            {year.status === "closed" && !openYear && <button className="tertiary-button" type="button" disabled={busy === year.id} aria-describedby={failed ? errorId : undefined} onClick={() => setStatus(year, "open")}>{copy.reopenYear}</button>}
          </div>
        )}
      </article>
    );
  };

  const setRowError = (id: string, message: string) => setRowErrors((current) => ({ ...current, [id]: message }));

  const saveAccount = async (account: MoneyAccountWithOpening, change: Record<string, unknown>, done: string) => {
    setBusy(account.id); setRowError(account.id, ""); setAccountStatus("");
    const result = await send<MoneyAccount & { openingBalance?: string }>(`${api}/money-accounts/${account.id}`, "PATCH", change);
    setBusy(null);
    if (!result.ok) { setRowError(account.id, result.message); return false; }
    setAccounts((current) => current.map((item) => item.id === result.data.id ? { ...item, ...result.data } : item));
    setAccountStatus(done);
    return true;
  };

  const rename = async (account: MoneyAccountWithOpening, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 100) { setRowError(account.id, copy.errors.INVALID_MONEY_ACCOUNT); return; }
    if (trimmed === account.name) { setRenaming(null); setRowError(account.id, ""); return; }
    if (await saveAccount(account, { name: trimmed }, copy.accountRenamed)) setRenaming(null);
  };

  const saveOpening = async (account: MoneyAccountWithOpening, amount: string) => {
    if (!openYear) return;
    let pence: number;
    try { pence = parsePounds(amount.trim()); } catch { setRowError(account.id, copy.errors.INVALID_AMOUNT); return; }
    if (await saveAccount(account, { openingBalance: { yearId: openYear.id, amount: formatPence(pence) } }, copy.openingSaved)) setOpening(null);
  };

  const usedSheets = new Set(accounts.filter((account) => account.isActive).map((account) => account.sheetName));
  const freeSheets = (sheets ?? []).filter((sheet) => !usedSheets.has(sheet.name)).map((sheet) => sheet.name);
  const chosenSheet = freeSheets.includes(newAccount.sheetName) ? newAccount.sheetName : freeSheets[0] ?? "";

  const addAccount = async () => {
    const name = newAccount.name.trim();
    if (!name || name.length > 100) { setAddError(copy.errors.INVALID_MONEY_ACCOUNT); return; }
    setBusy("new-account"); setAddError(null); setAccountStatus("");
    const result = await send<MoneyAccount>(`${api}/money-accounts`, "POST", { name, kind: newAccount.kind, sheetName: chosenSheet });
    if (result.ok) {
      setNewAccount({ name: "", kind: newAccount.kind, sheetName: "" });
      await load();
      setAccountStatus(copy.accountAdded);
    } else {
      setAddError(result.message);
    }
    setBusy(null);
  };

  const renderAccount = (account: MoneyAccountWithOpening) => {
    const nameId = `account-${account.id}-name`;
    const errorId = `account-${account.id}-error`;
    const hintId = `account-${account.id}-hint`;
    const error = rowErrors[account.id];
    const isBusy = busy === account.id;
    const describedBy = error ? errorId : undefined;
    const editing = renaming?.id === account.id || opening?.id === account.id;
    const cancel = () => { setRenaming(null); setOpening(null); setRowError(account.id, ""); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    return (
      <article className="settings-item" key={account.id} aria-labelledby={nameId}>
        <div>
          <strong id={nameId}>{account.name}</strong>
          <small>{fill(copy.accountLine, { kind: copy.kinds[account.kind], sheet: account.sheetName })}</small>
          {openYear && account.openingBalance !== null && <small>{fill(copy.openingLine, { amount: pounds(account.openingBalance) })}</small>}
          <small>{account.isActive ? copy.active : copy.inactive}</small>
          {renaming?.id === account.id && (
            <form className="money-form" onSubmit={(event) => { event.preventDefault(); void rename(account, renaming.name); }}>
              <label className="sr-only" htmlFor={`account-${account.id}-rename`}>{fill(copy.newName, { name: account.name })}</label>
              <input className="page-input" id={`account-${account.id}-rename`} value={renaming.name} maxLength={100} autoFocus disabled={isBusy} aria-invalid={error ? true : undefined} aria-describedby={describedBy} onChange={(event) => setRenaming({ id: account.id, name: event.target.value })} onKeyDown={escape} />
              <div className="page-actions"><button className="primary-button" type="submit" disabled={isBusy}>{copy.save}</button><button className="tertiary-button" type="button" disabled={isBusy} onClick={cancel}>{copy.cancel}</button></div>
            </form>
          )}
          {opening?.id === account.id && (
            <form className="money-form" onSubmit={(event) => { event.preventDefault(); void saveOpening(account, opening.amount); }}>
              <div className="money-field">
                <label htmlFor={`account-${account.id}-opening`}>{fill(copy.openingFor, { name: account.name })}</label>
                <input className="page-input" id={`account-${account.id}-opening`} value={opening.amount} inputMode="decimal" autoComplete="off" autoFocus disabled={isBusy} aria-invalid={error ? true : undefined} aria-describedby={error ? `${hintId} ${errorId}` : hintId} onChange={(event) => setOpening({ id: account.id, amount: event.target.value })} onKeyDown={escape} />
                <p className="money-hint" id={hintId}>{copy.openingHint}</p>
              </div>
              <div className="page-actions"><button className="primary-button" type="submit" disabled={isBusy}>{copy.save}</button><button className="tertiary-button" type="button" disabled={isBusy} onClick={cancel}>{copy.cancel}</button></div>
            </form>
          )}
          {error && <p id={errorId} className="page-error" role="alert">{error}</p>}
        </div>
        {!readOnly && !editing && (
          <div className="page-actions">
            <button className="tertiary-button" type="button" disabled={isBusy} aria-describedby={describedBy} onClick={() => { cancel(); setRenaming({ id: account.id, name: account.name }); }}>{copy.rename}</button>
            {openYear && account.openingBalance !== null && <button className="tertiary-button" type="button" disabled={isBusy} aria-describedby={describedBy} onClick={() => { cancel(); setOpening({ id: account.id, amount: account.openingBalance === "0.00" ? "" : account.openingBalance ?? "" }); }}>{copy.setOpening}</button>}
            <button className="secondary-button" type="button" disabled={isBusy} aria-describedby={describedBy} onClick={() => void saveAccount(account, { isActive: !account.isActive }, account.isActive ? copy.accountDeactivated : copy.accountActivated)}>{account.isActive ? copy.deactivate : copy.activate}</button>
          </div>
        )}
      </article>
    );
  };

  return (
    <main className="operational-page settings-page">
      <div className="page-shell settings-shell money-shell">
        <Link className="page-back" href={hrefFor(`/business/${businessId}/invoices`)}>{copy.brand} / {copy.title}</Link>
        <section className="page-card" aria-labelledby="money-title">
          <p className="page-eyebrow">{copy.eyebrow}</p>
          <h1 className="page-title" id="money-title">{copy.title}</h1>
          <p className="page-description">{copy.description}</p>
          {readOnly && <p className="page-empty">{copy.readOnly}</p>}
          {loadError && <p className="page-error" role="alert">{loadError}</p>}
        </section>

        <section className="page-card" aria-labelledby="year-title">
          <h2 id="year-title">{copy.yearTitle}</h2>
          <p className="page-description">{copy.yearHint}</p>
          {loaded && (
            <>
              {currentYear && <div className="settings-items">{renderYear(currentYear)}</div>}
              {openYear && !readOnly && <p className="money-hint">{copy.oneOpenYear}</p>}
              {!openYear && !readOnly && !editingYear && (
                <>
                  <p className={years.length === 0 ? "page-empty" : "money-hint"}>{years.length === 0 ? copy.yearEmpty : copy.nextYearHint}</p>
                  {renderDates("new", yearForm, setYearForm)}
                </>
              )}
              {pastYears.length > 0 && (
                <>
                  <h3>{copy.pastYears}</h3>
                  <div className="settings-items">{pastYears.map(renderYear)}</div>
                </>
              )}
            </>
          )}
          <p className="page-feedback" role="status" aria-live="polite">{yearStatus}</p>
        </section>

        <section className="page-card" aria-labelledby="accounts-title">
          <h2 id="accounts-title">{copy.accountsTitle}</h2>
          <p className="page-description">{copy.accountsHint}</p>
          {loaded && (
            <>
              {sheets === null && <p className="page-empty">{copy.noTemplate} <Link className="money-link" href={hrefFor(`/business/${businessId}/settings/workbook`)}>{copy.templateLink}</Link></p>}
              {sheets !== null && !openYear && <p className="money-hint">{copy.noOpenYear}</p>}
              {accounts.length > 0 ? <div className="settings-items">{accounts.map(renderAccount)}</div> : sheets !== null && <p className="page-empty">{copy.accountsEmpty}</p>}
              {sheets !== null && !readOnly && (
                <form className="money-form money-add" noValidate onSubmit={(event) => { event.preventDefault(); void addAccount(); }}>
                  <h3>{copy.addTitle}</h3>
                  <div className="money-field">
                    <label htmlFor="account-new-name">{copy.accountName}</label>
                    <input className="page-input" id="account-new-name" value={newAccount.name} maxLength={100} autoComplete="off" disabled={busy === "new-account"} aria-invalid={addError ? true : undefined} aria-describedby={addError ? "account-new-error" : undefined} onChange={(event) => setNewAccount({ ...newAccount, name: event.target.value })} />
                  </div>
                  <fieldset className="money-kind">
                    <legend>{copy.kindLabel}</legend>
                    <div>
                      {(["bank", "cash"] as const).map((kind) => (
                        <label key={kind}><input type="radio" name="account-new-kind" value={kind} checked={newAccount.kind === kind} disabled={busy === "new-account"} onChange={() => setNewAccount({ ...newAccount, kind })} />{copy.kinds[kind]}</label>
                      ))}
                    </div>
                  </fieldset>
                  {freeSheets.length === 0 ? <p className="page-empty">{copy.noFreeSheet}</p> : (
                    <>
                      <div className="money-field">
                        <label htmlFor="account-new-sheet">{copy.sheetLabel}</label>
                        <select className="page-input" id="account-new-sheet" value={chosenSheet} disabled={busy === "new-account"} aria-describedby="account-new-sheet-hint" onChange={(event) => setNewAccount({ ...newAccount, sheetName: event.target.value })}>
                          {freeSheets.map((name) => <option key={name} value={name}>{name}</option>)}
                        </select>
                      </div>
                      <div className="page-actions"><button className="primary-button" type="submit" disabled={busy === "new-account"} aria-describedby={addError ? "account-new-error" : undefined}>{copy.addAccount}</button></div>
                    </>
                  )}
                  <p className="money-hint" id="account-new-sheet-hint">{copy.sheetHint}</p>
                  {addError && <p id="account-new-error" className="page-error" role="alert">{addError}</p>}
                </form>
              )}
            </>
          )}
          <p className="page-feedback" role="status" aria-live="polite">{accountStatus}</p>
        </section>
      </div>
    </main>
  );
}
