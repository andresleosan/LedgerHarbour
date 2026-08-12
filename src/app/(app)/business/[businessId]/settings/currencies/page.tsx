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
  const { locale, setLocale, hrefFor } = useUrlLocale();
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
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/businesses/${businessId}/currencies`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.name, symbol: form.symbol, decimalCount: Number(form.decimalCount), isoCode: form.isoCode || null }) });
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
    setBusy(true);
    setError(null);
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
    <main className="settings-page"><style>{`.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}`}</style>
      <style>{`*{box-sizing:border-box}body{margin:0;background:#f7f8f5;color:#17313b;font-family:Inter,ui-sans-serif,system-ui,sans-serif}.settings-page{min-height:100vh;padding:24px;background:linear-gradient(135deg,#f7f8f5,#edf3ef)}.shell{width:min(100%,900px);margin:auto}.toolbar{display:flex;justify-content:flex-end;gap:8px;color:#49636b;font-size:.82rem}.locale{border:1px solid transparent;border-radius:999px;padding:8px 12px;background:transparent;color:#315b60;cursor:pointer;font:inherit;font-weight:750}.locale[aria-pressed=true]{border-color:#91b9ad;background:#fff}.back{display:inline-block;margin-top:44px;color:#0b6b66;font-weight:800}.card{margin-top:20px;padding:30px;border:1px solid #c6d8d0;border-radius:22px;background:#fff;box-shadow:0 18px 40px #17313b12}.eyebrow{margin:0 0 10px;color:#0b6b66;font-size:.75rem;font-weight:850;letter-spacing:.14em;text-transform:uppercase}h1{margin:0;letter-spacing:-.06em;font-size:clamp(2.4rem,6vw,4.8rem)}.description{color:#49636b;line-height:1.6}.create{display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;gap:9px;margin:24px 0}.create input{min-height:44px;border:1px solid #9fbab1;border-radius:9px;padding:0 10px;font:inherit}.button{min-height:44px;border:1px solid #0b6b66;border-radius:10px;padding:0 14px;background:#0b6b66;color:#fff;cursor:pointer;font:inherit;font-weight:800;transition:transform .18s ease,background-color .18s ease}.button:hover{background:#075b57;transform:translateY(-1px)}.button.secondary{border-color:#a65d48;background:#fff3ed;color:#7a3f31}.items{display:grid;gap:10px}.item{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:15px;border:1px solid #d0ded8;border-radius:12px}.item small{display:block;margin-top:4px;color:#49636b}.actions{display:flex;gap:8px}.error{color:#8d3f34;font-weight:750}@media(max-width:800px){.create{grid-template-columns:1fr 1fr}.create input:first-of-type{grid-column:span 2}}@media(max-width:600px){.settings-page{padding:18px}.create{display:flex;flex-direction:column}.item{align-items:stretch;flex-direction:column}.actions .button{width:100%}}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid #d46d42;outline-offset:3px}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}`}</style>
      <div className="shell">
        <div className="toolbar" aria-label={copy.languageLabel}><span>{copy.languageLabel}</span>{(["en", "es"] as const).map((candidate) => <button className="locale" key={candidate} type="button" aria-pressed={locale === candidate} onClick={() => setLocale(candidate)}>{candidate === "en" ? copy.localeEnglish : copy.localeSpanish}</button>)}</div>
         <Link className="back" href={hrefFor(`/business/${businessId}/invoices`)}>{copy.brand} / {copy.title}</Link>
        <section className="card" aria-labelledby="currencies-title">
          <p className="eyebrow">{copy.eyebrow}</p><h1 id="currencies-title">{copy.title}</h1><p className="description">{copy.description}</p>
          <form className="create" onSubmit={(event) => void create(event)} aria-describedby={error ? "currencies-error" : undefined}>
            <label htmlFor="currency-name" className="sr-only">{copy.nameLabel}</label><input id="currency-name" name="currencyName" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder={copy.nameLabel} disabled={busy} />
            <label htmlFor="currency-symbol" className="sr-only">{copy.symbolLabel}</label><input id="currency-symbol" name="currencySymbol" value={form.symbol} onChange={(event) => setForm((current) => ({ ...current, symbol: event.target.value }))} placeholder={copy.symbolLabel} disabled={busy} />
            <label htmlFor="currency-decimals" className="sr-only">{copy.decimalLabel}</label><input id="currency-decimals" name="currencyDecimals" type="number" min="0" max="6" value={form.decimalCount} onChange={(event) => setForm((current) => ({ ...current, decimalCount: event.target.value }))} aria-describedby={error ? "currencies-error" : undefined} disabled={busy} />
            <label htmlFor="currency-iso" className="sr-only">{copy.isoLabel}</label><input id="currency-iso" name="currencyIso" value={form.isoCode} onChange={(event) => setForm((current) => ({ ...current, isoCode: event.target.value }))} placeholder={copy.isoLabel} disabled={busy} />
            <button className="button" type="submit" disabled={busy}>{copy.create}</button>
          </form>
          {error && <p id="currencies-error" className="error" role="alert">{error}</p>}
          {currencies.length === 0 ? <p>{copy.empty}</p> : <div className="items" aria-label={copy.title}>{currencies.map((currency) => <article className="item" key={currency.id}><div><strong>{currency.name} ({currency.symbol})</strong><small>{currency.isoCode ?? "-"} · {currency.isStandard ? copy.standard : copy.custom}{!currency.isActive && ` · ${copy.inactive}`}</small></div><div className="actions">{currency.isActive && <button className="button secondary" type="button" onClick={() => void deactivate(currency)} disabled={busy}>{copy.deactivate}</button>}</div></article>)}</div>}
        </section>
      </div>
    </main>
  );
}
