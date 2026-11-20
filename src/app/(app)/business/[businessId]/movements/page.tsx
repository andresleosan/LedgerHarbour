"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

import { messages } from "@/i18n/config";
import type { AccountHeading, HeadingGroup } from "@/modules/accounting/heading-service";
import { formatPence, parsePounds, sumPence } from "@/modules/accounting/money";
import type { FinancialYear, Movement } from "@/modules/accounting/money-repository";
import type { MoneyAccountWithOpening } from "@/modules/accounting/money-service";
import { useUrlLocale } from "@/ui/useUrlLocale";

type Copy = typeof messages.en.movements;
type Kind = "in" | "drawings" | "charges" | "transfer";
type Form = { kind: Kind | ""; accountId: string; toAccountId: string; date: string; amount: string; headingId: string; narrative: string };
type Field = keyof Form | "form";
type Errors = Partial<Record<Field, string>>;
type Edit = { rowId: string; movementId?: string; transferGroupId?: string; form: Form };

const GROUPS: HeadingGroup[] = ["income", "cost_of_sales", "expenses", "assets", "liabilities", "equity"];
const KINDS: Kind[] = ["in", "drawings", "charges", "transfer"];
const PAGE = 50;
// A refusal the server explains about one control is shown next to that control.
const FIELD_FOR: Record<string, Field> = {
  INVALID_AMOUNT: "amount",
  MOVEMENT_OUTSIDE_OPEN_YEAR: "date",
  HEADING_NOT_FOUND: "headingId",
  HEADING_NOT_USABLE: "headingId",
  MONEY_ACCOUNT_NOT_FOUND: "accountId",
  MONEY_ACCOUNT_INACTIVE: "accountId",
};

const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);
const errorFor = (code: string | undefined, copy: Copy) => code && code in copy.errors ? copy.errors[code as keyof Copy["errors"]] : copy.saveError;
const emptyForm: Form = { kind: "", accountId: "", toAccountId: "", date: "", amount: "", headingId: "", narrative: "" };
const usable = (heading: AccountHeading) => heading.isActive && heading.blockedReason === null;

function defaultDate(year: FinancialYear): string {
  const today = new Date().toLocaleDateString("en-CA");
  return today < year.startDate ? year.startDate : today > year.endDate ? year.endDate : today;
}

/** Positive pence typed without a sign, or null. */
function typedPence(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d/.test(trimmed)) return null;
  try {
    const pence = parsePounds(trimmed);
    return pence > 0 ? pence : null;
  } catch {
    return null;
  }
}

export default function MovementsPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = use(params);
  const { locale, hrefFor } = useUrlLocale();
  const copy = messages[locale].movements;
  const groupLabels = messages[locale].workbookSettings.groups;
  const api = `/api/businesses/${businessId}`;
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [year, setYear] = useState<FinancialYear | null>(null);
  const [accounts, setAccounts] = useState<MoneyAccountWithOpening[]>([]);
  const [headings, setHeadings] = useState<AccountHeading[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [errors, setErrors] = useState<{ prefix: string; fields: Errors } | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [formStatus, setFormStatus] = useState("");
  const [listStatus, setListStatus] = useState("");
  const [filter, setFilter] = useState("");
  const [visible, setVisible] = useState(PAGE);

  const load = async (): Promise<string | null> => {
    try {
      const yearsResponse = await fetch(`${api}/financial-years`);
      if (!yearsResponse.ok) throw new Error();
      const open = (await yearsResponse.json() as FinancialYear[]).find((item) => item.status === "open") ?? null;
      let suggested: string | null = null;
      if (open) {
        const yearId = encodeURIComponent(open.id);
        const responses = await Promise.all([fetch(`${api}/money-accounts?yearId=${yearId}`), fetch(`${api}/headings`), fetch(`${api}/movements?yearId=${yearId}`), fetch(`${api}/transfers/suggestion`)]);
        if (responses.some((response) => !response.ok)) throw new Error();
        const [loadedAccounts, loadedHeadings, loadedMovements, loadedSuggestion] = await Promise.all(responses.map((response) => response.json())) as [MoneyAccountWithOpening[], AccountHeading[], Movement[], { headingId: string | null }];
        const active = loadedAccounts.filter((account) => account.isActive);
        suggested = loadedSuggestion.headingId;
        setAccounts(loadedAccounts);
        setHeadings(loadedHeadings);
        setMovements(loadedMovements);
        setSuggestion(suggested);
        setForm((current) => ({
          ...current,
          accountId: active.some((account) => account.id === current.accountId) ? current.accountId : active[0]?.id ?? "",
          toAccountId: active.some((account) => account.id === current.toAccountId) ? current.toAccountId : active.find((account) => account.id !== (current.accountId || active[0]?.id))?.id ?? "",
          date: current.date || defaultDate(open),
        }));
      }
      setYear(open);
      setLoadError(null);
      setLoaded(true);
      return suggested;
    } catch {
      setLoadError(copy.loadError);
      return null;
    }
  };

  useEffect(() => { void load(); }, [businessId]);

  const send = async (url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<{ ok: true } | { ok: false; code?: string }> => {
    try {
      const response = await fetch(url, body === undefined ? { method } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (response.ok) return { ok: true };
      if (response.status === 403) setReadOnly(true);
      const payload = await response.json().catch(() => ({})) as { error?: { code?: string } };
      return { ok: false, code: payload.error?.code };
    } catch {
      return { ok: false };
    }
  };

  const activeAccounts = accounts.filter((account) => account.isActive);
  const usableHeadings = headings.filter(usable);
  const accountName = (id: string) => accounts.find((account) => account.id === id)?.name ?? "";
  const headingName = (id: string | null) => headings.find((heading) => heading.id === id)?.displayName ?? "";
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  const pounds = (pence: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "GBP", currencyDisplay: "narrowSymbol" }).format(formatPence(pence) as `${number}`);
  const signed = (amount: string) => {
    const pence = parsePounds(amount);
    return fill(pence < 0 ? copy.amountOut : copy.amountIn, { amount: pounds(Math.abs(pence)) });
  };

  const validate = (target: Form): Errors => {
    const fields: Errors = {};
    if (!target.kind) fields.kind = copy.errors.chooseKind;
    if (!target.accountId) fields.accountId = copy.errors.chooseAccount;
    if (target.kind === "transfer" && !target.toAccountId) fields.toAccountId = copy.errors.chooseAccount;
    if (target.kind === "transfer" && target.toAccountId && target.toAccountId === target.accountId) fields.toAccountId = copy.errors.sameAccount;
    if (year && (!target.date || target.date < year.startDate || target.date > year.endDate)) fields.date = fill(copy.errors.dateOutside, { start: date(year.startDate), end: date(year.endDate) });
    if (typedPence(target.amount) === null) fields.amount = copy.errors.INVALID_AMOUNT;
    if (!target.headingId) fields.headingId = copy.errors.chooseCode;
    const narrative = target.narrative.trim();
    if ((target.kind !== "transfer" && !narrative) || narrative.length > 200) fields.narrative = copy.errors.narrative;
    return fields;
  };

  const submit = async (prefix: "new" | "edit") => {
    const target = prefix === "new" ? form : edit?.form;
    if (!target) return;
    const fields = validate(target);
    if (Object.keys(fields).length > 0) { setErrors({ prefix, fields }); return; }
    const pence = typedPence(target.amount)!;
    const transfer = target.kind === "transfer";
    const body = transfer
      ? { fromAccountId: target.accountId, toAccountId: target.toAccountId, date: target.date, amount: formatPence(pence), headingId: target.headingId, narrative: target.narrative.trim() || copy.origins.transfer }
      : { accountId: target.accountId, date: target.date, narrative: target.narrative.trim(), headingId: target.headingId, amount: formatPence(target.kind === "in" ? pence : -pence) };
    const id = prefix === "edit" ? (transfer ? edit?.transferGroupId : edit?.movementId) : undefined;
    const url = `${api}/${transfer ? "transfers" : "movements"}${id ? `/${id}` : ""}`;
    setBusy(prefix); setErrors(null); setFormStatus(""); setListStatus("");
    const result = await send(url, id ? "PATCH" : "POST", body);
    if (!result.ok) {
      setErrors({ prefix, fields: { [FIELD_FOR[result.code ?? ""] ?? "form"]: errorFor(result.code, copy) } });
      setBusy(null);
      return;
    }
    const suggested = await load();
    if (prefix === "new") {
      setForm((current) => ({ ...current, amount: "", narrative: "", headingId: current.kind === "transfer" ? suggested ?? "" : "" }));
      setFormStatus(transfer ? copy.transferSaved : copy.saved);
    } else {
      setEdit(null);
      setListStatus(copy.changesSaved);
    }
    setBusy(null);
  };

  const startEdit = (movement: Movement) => {
    setErrors(null); setFormStatus(""); setListStatus("");
    const base = { date: movement.movementDate, headingId: movement.headingId ?? "", narrative: movement.narrative };
    if (movement.transferGroupId) {
      const legs = movements.filter((item) => item.transferGroupId === movement.transferGroupId);
      const from = legs.find((item) => item.amount.startsWith("-")) ?? movement;
      const to = legs.find((item) => !item.amount.startsWith("-")) ?? movement;
      setEdit({ rowId: movement.id, transferGroupId: movement.transferGroupId, form: { ...base, kind: "transfer", accountId: from.moneyAccountId, toAccountId: to.moneyAccountId, amount: to.amount } });
      return;
    }
    const pence = parsePounds(movement.amount);
    const owner = headings.find((heading) => heading.id === movement.headingId)?.group === "equity";
    setEdit({ rowId: movement.id, movementId: movement.id, form: { ...base, kind: pence > 0 ? "in" : owner ? "drawings" : "charges", accountId: movement.moneyAccountId, toAccountId: "", amount: formatPence(Math.abs(pence)) } });
  };

  const remove = async (movement: Movement) => {
    const transfer = movement.transferGroupId !== null;
    if (!window.confirm(transfer ? copy.confirmDeleteTransfer : copy.confirmDelete)) return;
    setBusy(movement.id); setRowErrors({}); setListStatus(""); setFormStatus("");
    const result = await send(transfer ? `${api}/transfers/${movement.transferGroupId}` : `${api}/movements/${movement.id}`, "DELETE");
    if (result.ok) {
      await load();
      setListStatus(transfer ? copy.transferDeleted : copy.deleted);
    } else {
      setRowErrors({ [movement.id]: errorFor(result.code, copy) });
    }
    setBusy(null);
  };

  const renderForm = (prefix: "new" | "edit", target: Form, update: (patch: Partial<Form>) => void) => {
    const fields = errors?.prefix === prefix ? errors.fields : {};
    const isBusy = busy === prefix;
    const transfer = target.kind === "transfer";
    const id = (name: Field, suffix = "") => `${prefix}-${name}${suffix}`;
    const aria = (name: Field, hint = false) => {
      const describedBy = [hint ? id(name, "-hint") : "", fields[name] ? id(name, "-error") : ""].filter(Boolean).join(" ");
      return { "aria-invalid": fields[name] ? true : undefined, "aria-describedby": describedBy || undefined };
    };
    const error = (name: Field) => fields[name] ? <p id={id(name, "-error")} className="page-error" role="alert">{fields[name]}</p> : null;
    const chooseKind = (kind: Kind) => update({ kind, ...((kind === "transfer") !== transfer ? { headingId: kind === "transfer" ? suggestion ?? "" : "" } : {}) });
    const kinds = prefix === "new" ? KINDS : transfer ? [] : KINDS.filter((kind) => kind !== "transfer");
    const offered = headings.filter((heading) => usable(heading) || heading.id === target.headingId);
    const accountSelect = (name: "accountId" | "toAccountId", label: string) => (
      <div className="money-field">
        <label htmlFor={id(name)}>{label}</label>
        <select className="page-input" id={id(name)} value={target[name]} disabled={isBusy} {...aria(name)} onChange={(event) => update({ [name]: event.target.value })}>
          <option value="">{copy.chooseAccount}</option>
          {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
        {error(name)}
      </div>
    );
    return (
      <form className="money-form" noValidate onSubmit={(event) => { event.preventDefault(); void submit(prefix); }}>
        {kinds.length > 0 && (
          <fieldset className="money-kind movement-kinds" aria-describedby={aria("kind")["aria-describedby"]}>
            <legend>{copy.kindLabel}</legend>
            <div>
              {kinds.map((kind) => (
                <label key={kind}><input type="radio" name={id("kind")} value={kind} checked={target.kind === kind} disabled={isBusy} onChange={() => chooseKind(kind)} />{copy.kinds[kind]}</label>
              ))}
            </div>
            {error("kind")}
          </fieldset>
        )}
        {target.kind && (
          <>
            {transfer ? <div className="money-dates">{accountSelect("accountId", copy.from)}{accountSelect("toAccountId", copy.to)}</div> : accountSelect("accountId", copy.account)}
            <div className="money-dates">
              <div className="money-field">
                <label htmlFor={id("date")}>{copy.date}</label>
                <input className="page-input" id={id("date")} type="date" required min={year?.startDate} max={year?.endDate} value={target.date} disabled={isBusy} {...aria("date")} onChange={(event) => update({ date: event.target.value })} />
                {error("date")}
              </div>
              <div className="money-field">
                <label htmlFor={id("amount")}>{copy.amount}</label>
                <input className="page-input" id={id("amount")} value={target.amount} inputMode="decimal" autoComplete="off" disabled={isBusy} {...aria("amount", true)} onChange={(event) => update({ amount: event.target.value })} />
                <p className="money-hint" id={id("amount", "-hint")}>{transfer ? copy.amountHintTransfer : target.kind === "in" ? copy.amountHintIn : copy.amountHintOut}</p>
                {error("amount")}
              </div>
            </div>
            <div className="money-field">
              <label htmlFor={id("headingId")}>{copy.code}</label>
              <select className="page-input" id={id("headingId")} value={target.headingId} disabled={isBusy} {...aria("headingId", transfer)} onChange={(event) => update({ headingId: event.target.value })}>
                <option value="">{copy.chooseCode}</option>
                {GROUPS.map((group) => {
                  const items = offered.filter((heading) => heading.group === group);
                  return items.length === 0 ? null : <optgroup key={group} label={groupLabels[group]}>{items.map((heading) => <option key={heading.id} value={heading.id}>{heading.displayName}</option>)}</optgroup>;
                })}
              </select>
              {transfer && <p className="money-hint" id={id("headingId", "-hint")}>{copy.transferCodeHint}</p>}
              {error("headingId")}
            </div>
            <div className="money-field">
              <label htmlFor={id("narrative")}>{transfer ? copy.narrativeOptional : copy.narrative}</label>
              <input className="page-input" id={id("narrative")} value={target.narrative} maxLength={200} autoComplete="off" disabled={isBusy} {...aria("narrative")} onChange={(event) => update({ narrative: event.target.value })} />
              {error("narrative")}
            </div>
          </>
        )}
        <div className="page-actions">
          <button className="primary-button" type="submit" disabled={isBusy} aria-describedby={fields.form ? id("form", "-error") : undefined}>{prefix === "edit" ? copy.saveChanges : transfer ? copy.saveTransfer : copy.save}</button>
          {prefix === "edit" && <button className="tertiary-button" type="button" disabled={isBusy} onClick={() => { setEdit(null); setErrors(null); }}>{copy.cancel}</button>}
        </div>
        {error("form")}
      </form>
    );
  };

  const balances = accounts
    .filter((account) => account.isActive || movements.some((movement) => movement.moneyAccountId === account.id))
    .map((account) => {
      const amounts = movements.filter((movement) => movement.moneyAccountId === account.id).map((movement) => parsePounds(movement.amount));
      const opening = parsePounds(account.openingBalance ?? "0.00");
      const moneyIn = sumPence(amounts.filter((pence) => pence > 0));
      const moneyOut = sumPence(amounts.filter((pence) => pence < 0));
      return { account, opening, moneyIn, moneyOut: -moneyOut, now: sumPence([opening, moneyIn, moneyOut]) };
    });

  const newestFirst = [...movements].reverse().filter((movement) => !filter || movement.moneyAccountId === filter);
  const shown = newestFirst.slice(0, visible);
  const originLabel = (movement: Movement) => movement.origin !== "manual" ? copy.origins[movement.origin] : movement.transferGroupId ? copy.origins.transfer : copy.origins.manual;

  const renderMovement = (movement: Movement) => {
    const editing = edit !== null && (edit.movementId === movement.id || (edit.transferGroupId !== undefined && edit.transferGroupId === movement.transferGroupId));
    const errorId = `movement-${movement.id}-error`;
    const error = rowErrors[movement.id];
    const amount = signed(movement.amount);
    return (
      <li className="settings-item movement-row" key={movement.id}>
        <div>
          <strong>{movement.narrative}</strong>
          <small>{[date(movement.movementDate), accountName(movement.moneyAccountId), headingName(movement.headingId)].filter(Boolean).join(" · ")}</small>
          <small><span className="movement-origin">{originLabel(movement)}</span></small>
          {edit?.rowId === movement.id && renderForm("edit", edit.form, (patch) => setEdit((current) => current && { ...current, form: { ...current.form, ...patch } }))}
          {error && <p id={errorId} className="page-error" role="alert">{error}</p>}
        </div>
        <div className="movement-side">
          <span className="movement-amount">{amount}</span>
          {movement.origin === "manual" && !readOnly && !editing && (
            <div className="page-actions">
              <button className="tertiary-button" type="button" disabled={busy !== null} aria-describedby={error ? errorId : undefined} onClick={() => startEdit(movement)}>{copy.edit}<span className="sr-only"> {movement.narrative}, {amount}</span></button>
              <button className="secondary-button" type="button" disabled={busy !== null} aria-describedby={error ? errorId : undefined} onClick={() => void remove(movement)}>{copy.delete}<span className="sr-only"> {movement.narrative}, {amount}</span></button>
            </div>
          )}
        </div>
      </li>
    );
  };

  const ready = year !== null && activeAccounts.length > 0;

  return (
    <main className="operational-page settings-page">
      <div className="page-shell settings-shell money-shell">
        <Link className="page-back" href={hrefFor(`/business/${businessId}/invoices`)}>{copy.brand} / {copy.title}</Link>
        <section className="page-card" aria-labelledby="movements-title">
          <p className="page-eyebrow">{copy.eyebrow}</p>
          <h1 className="page-title" id="movements-title">{copy.title}</h1>
          <p className="page-description">{copy.description}</p>
          <Link className="money-link" href={hrefFor(`/business/${businessId}/movements/import`)}>{messages[locale].statementImport.link}</Link>
          {readOnly && <p className="page-empty">{copy.readOnly}</p>}
          {loadError && <p className="page-error" role="alert">{loadError}</p>}
          {loaded && !ready && <p className="page-empty">{copy.notReady} <Link className="money-link" href={hrefFor(`/business/${businessId}/settings/accounts`)}>{copy.notReadyLink}</Link></p>}
        </section>

        {loaded && ready && (
          <>
            <section className="page-card" aria-labelledby="balances-title">
              <h2 id="balances-title">{copy.balancesTitle}</h2>
              <div className="movement-balances">
                {balances.map(({ account, opening, moneyIn, moneyOut, now }) => (
                  <article className="movement-balance" key={account.id} aria-labelledby={`balance-${account.id}`}>
                    <h3 id={`balance-${account.id}`}>{account.name}</h3>
                    <dl>
                      <div><dt>{copy.opening}</dt><dd>{pounds(opening)}</dd></div>
                      <div><dt>{copy.moneyIn}</dt><dd>{pounds(moneyIn)}</dd></div>
                      <div><dt>{copy.moneyOut}</dt><dd>{pounds(moneyOut)}</dd></div>
                      <div><dt>{copy.balanceNow}</dt><dd>{pounds(now)}</dd></div>
                    </dl>
                  </article>
                ))}
              </div>
            </section>

            {!readOnly && (
              <section className="page-card" aria-labelledby="add-title">
                <h2 id="add-title">{copy.addTitle}</h2>
                {usableHeadings.length === 0
                  ? <p className="page-empty">{copy.noCodes} <Link className="money-link" href={hrefFor(`/business/${businessId}/settings/workbook`)}>{copy.noCodesLink}</Link></p>
                  : renderForm("new", form, (patch) => setForm((current) => ({ ...current, ...patch })))}
                <p className="page-feedback" role="status" aria-live="polite">{formStatus}</p>
              </section>
            )}

            <section className="page-card" aria-labelledby="list-title">
              <h2 id="list-title">{copy.listTitle}</h2>
              <div className="money-field movement-filter">
                <label htmlFor="movement-filter">{copy.filterLabel}</label>
                <select className="page-input" id="movement-filter" value={filter} onChange={(event) => { setFilter(event.target.value); setVisible(PAGE); }}>
                  <option value="">{copy.allAccounts}</option>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </div>
              {movements.some((movement) => movement.origin !== "manual") && <p className="money-hint">{copy.managedElsewhere}</p>}
              {shown.length === 0 ? <p className="page-empty">{copy.empty}</p> : <ul className="settings-items movement-list">{shown.map(renderMovement)}</ul>}
              {newestFirst.length > shown.length && (
                <div className="page-actions">
                  <p className="money-hint">{fill(copy.showing, { shown: shown.length, total: newestFirst.length })}</p>
                  <button className="tertiary-button" type="button" onClick={() => setVisible((current) => current + PAGE)}>{copy.showMore}</button>
                </div>
              )}
              <p className="page-feedback" role="status" aria-live="polite">{listStatus}</p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
