"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

import { messages } from "@/i18n/config";
import { useUrlLocale } from "@/ui/useUrlLocale";

type Currency = { id: string; name: string; symbol: string; isoCode: string | null; decimalCount: number; isStandard: boolean; isActive: boolean };
type ErrorPayload = { error?: { code?: string } };

function messageForError(code: string | undefined, copy: typeof messages.en.currencies): string {
  if (code === "CURRENCY_NAME_CONFLICT" || code === "CURRENCY_REPOSITORY_CONFLICT") return copy.conflictError;
  if (code === "INVALID_CURRENCY") return copy.invalidError;
  if (code === "BUSINESS_ACCESS_DENIED" || code === "INSUFFICIENT_CAPABILITY") return copy.accessError;
  if (code === "INACTIVE_BUSINESS") return copy.inactiveError;
  if (code === "CURRENCY_NOT_FOUND") return copy.notFoundError;
  return copy.networkError;
}

export default function CurrenciesPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = use(params);
  const { locale, hrefFor } = useUrlLocale();
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [form, setForm] = useState({ name: "", symbol: "", decimalCount: "2", isoCode: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = messages[locale].currencies;

  const load = async () => {
    try {
      const response = await fetch(`/api/businesses/${businessId}/currencies`);
      const payload = await response.json() as Currency[] & ErrorPayload;
      if (!response.ok) throw new Error(payload.error?.code);
      setCurrencies(payload as Currency[]);
    } catch (cause) {
      setError(messageForError(cause instanceof Error ? cause.message : undefined, copy));
    }
  };

  useEffect(() => { void load(); }, [businessId]);

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitted = new FormData(event.currentTarget);
    const submittedForm = { name: String(submitted.get("currencyName") ?? "").trim(), symbol: String(submitted.get("currencySymbol") ?? "").trim(), decimalCount: String(submitted.get("currencyDecimals") ?? "2"), isoCode: String(submitted.get("currencyIso") ?? "").trim() };
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/businesses/${businessId}/currencies`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: submittedForm.name, symbol: submittedForm.symbol, decimalCount: Number(submittedForm.decimalCount), isoCode: submittedForm.isoCode || null }) });
      const payload = await response.json() as Currency & ErrorPayload;
      if (!response.ok) throw new Error(payload.error?.code);
      setForm({ name: "", symbol: "", decimalCount: "2", isoCode: "" });
      await load();
    } catch (cause) {
      setError(messageForError(cause instanceof Error ? cause.message : undefined, copy));
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (currency: Currency) => {
    if (!window.confirm(copy.confirmDeactivate)) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/businesses/${businessId}/currencies`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currencyId: currency.id, isActive: false }) });
      const payload = await response.json() as Currency & ErrorPayload;
      if (!response.ok) throw new Error(payload.error?.code);
      await load();
    } catch (cause) {
      setError(messageForError(cause instanceof Error ? cause.message : undefined, copy));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="operational-page settings-page">
      <div className="page-shell currency-shell">
        <Link className="page-back" href={hrefFor(`/business/${businessId}/invoices`)}>{copy.brand} / {copy.title}</Link>
        <section className="page-card" aria-labelledby="currencies-title"><p className="page-eyebrow">{copy.eyebrow}</p><h1 className="page-title" id="currencies-title">{copy.title}</h1><p className="page-description">{copy.description}</p>
          <form className="currency-create" onSubmit={(event) => void create(event)} aria-describedby={error ? "currencies-error" : undefined}><label htmlFor="currency-name" className="sr-only">{copy.nameLabel}</label><input className="page-input" id="currency-name" name="currencyName" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder={copy.nameLabel} disabled={busy} /><label htmlFor="currency-symbol" className="sr-only">{copy.symbolLabel}</label><input className="page-input" id="currency-symbol" name="currencySymbol" value={form.symbol} onChange={(event) => setForm((current) => ({ ...current, symbol: event.target.value }))} placeholder={copy.symbolLabel} disabled={busy} /><label htmlFor="currency-decimals" className="sr-only">{copy.decimalLabel}</label><input className="page-input" id="currency-decimals" name="currencyDecimals" type="number" min="0" max="6" value={form.decimalCount} onChange={(event) => setForm((current) => ({ ...current, decimalCount: event.target.value }))} aria-describedby={error ? "currencies-error" : undefined} disabled={busy} /><label htmlFor="currency-iso" className="sr-only">{copy.isoLabel}</label><input className="page-input" id="currency-iso" name="currencyIso" value={form.isoCode} onChange={(event) => setForm((current) => ({ ...current, isoCode: event.target.value }))} placeholder={copy.isoLabel} disabled={busy} /><button className="primary-button" type="submit" disabled={busy}>{copy.create}</button></form>
          {error && <p id="currencies-error" className="page-error" role="alert">{error}</p>}
          {currencies.length === 0 ? <p className="page-empty">{copy.empty}</p> : <div className="settings-items" aria-label={copy.title}>{currencies.map((currency) => <article className="settings-item" key={currency.id}><div><strong>{currency.name} ({currency.symbol})</strong><small>{currency.isoCode ?? "-"} · {currency.isStandard ? copy.standard : copy.custom}{!currency.isActive && ` · ${copy.inactive}`}</small></div><div className="page-actions">{currency.isActive && <button className="secondary-button" type="button" onClick={() => void deactivate(currency)} disabled={busy}>{copy.deactivate}</button>}</div></article>)}</div>}
        </section>
      </div>
    </main>
  );
}
