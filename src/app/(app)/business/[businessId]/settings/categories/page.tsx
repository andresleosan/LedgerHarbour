"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

import { messages } from "@/i18n/config";
import { useUrlLocale } from "@/ui/useUrlLocale";

type Category = { id: string; name: string; isActive: boolean };
type ErrorPayload = { error?: { code?: string } };

function messageForError(code: string | undefined, copy: typeof messages.en.categories): string {
  if (code === "CATEGORY_NAME_CONFLICT") return copy.conflictError;
  if (code === "CATEGORY_REPOSITORY_CONFLICT") return copy.conflictError;
  if (code === "INVALID_CATEGORY") return copy.invalidError;
  if (code === "BUSINESS_ACCESS_DENIED" || code === "INSUFFICIENT_CAPABILITY") return copy.accessError;
  if (code === "INACTIVE_BUSINESS") return copy.inactiveError;
  if (code === "CATEGORY_NOT_FOUND") return copy.notFoundError;
  return copy.networkError;
}

export default function CategoriesPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = use(params);
  const { locale, setLocale, hrefFor } = useUrlLocale();
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = messages[locale].categories;

  const load = async () => {
    try {
      const response = await fetch(`/api/businesses/${businessId}/categories`);
      const payload = await response.json() as Category[] & ErrorPayload;
      if (!response.ok) throw new Error(payload.error?.code);
      setCategories(payload as Category[]);
    } catch (cause) {
      setError(messageForError(cause instanceof Error ? cause.message : undefined, copy));
    }
  };

  useEffect(() => { void load(); }, [businessId]);

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submittedName = String(new FormData(event.currentTarget).get("categoryName") ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/businesses/${businessId}/categories`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: submittedName }) });
      const payload = await response.json() as Category & ErrorPayload;
      if (!response.ok) throw new Error(payload.error?.code);
      setName("");
      await load();
    } catch (cause) {
      setError(messageForError(cause instanceof Error ? cause.message : undefined, copy));
    } finally {
      setBusy(false);
    }
  };

  const mutate = async (category: Category, nextName?: string) => {
    if (nextName === undefined && !window.confirm(copy.confirmDeactivate)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/businesses/${businessId}/categories`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categoryId: category.id, ...(nextName === undefined ? { isActive: false } : { name: nextName }) }) });
      const payload = await response.json() as Category & ErrorPayload;
      if (!response.ok) throw new Error(payload.error?.code);
      await load();
    } catch (cause) {
      setError(messageForError(cause instanceof Error ? cause.message : undefined, copy));
    } finally {
      setBusy(false);
    }
  };

  const rename = (category: Category) => {
    const nextName = window.prompt(copy.nameLabel, category.name)?.trim();
    if (nextName && nextName !== category.name) void mutate(category, nextName);
  };

  return (
    <main className="settings-page"><style>{`.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}`}</style>
      <style>{`*{box-sizing:border-box}body{margin:0;background:#f7f8f5;color:#17313b;font-family:Inter,ui-sans-serif,system-ui,sans-serif}.settings-page{min-height:100vh;padding:24px;background:linear-gradient(135deg,#f7f8f5,#edf3ef)}.shell{width:min(100%,820px);margin:auto}.toolbar{display:flex;justify-content:flex-end;gap:8px;color:#49636b;font-size:.82rem}.locale{border:1px solid transparent;border-radius:999px;padding:8px 12px;background:transparent;color:#315b60;cursor:pointer;font:inherit;font-weight:750}.locale[aria-pressed=true]{border-color:#91b9ad;background:#fff}.back{display:inline-block;margin-top:44px;color:#0b6b66;font-weight:800}.card{margin-top:20px;padding:30px;border:1px solid #c6d8d0;border-radius:22px;background:#fff;box-shadow:0 18px 40px #17313b12}.eyebrow{margin:0 0 10px;color:#0b6b66;font-size:.75rem;font-weight:850;letter-spacing:.14em;text-transform:uppercase}h1{margin:0;letter-spacing:-.06em;font-size:clamp(2.4rem,6vw,4.8rem)}.description{color:#49636b;line-height:1.6}.create{display:flex;gap:10px;margin:24px 0}.create input{flex:1;min-height:44px;border:1px solid #9fbab1;border-radius:9px;padding:0 12px;font:inherit}.button{min-height:44px;border:1px solid #0b6b66;border-radius:10px;padding:0 14px;background:#0b6b66;color:#fff;cursor:pointer;font:inherit;font-weight:800;transition:transform .18s ease,background-color .18s ease}.button:hover{background:#075b57;transform:translateY(-1px)}.button.secondary{border-color:#a65d48;background:#fff3ed;color:#7a3f31}.items{display:grid;gap:10px}.item{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:15px;border:1px solid #d0ded8;border-radius:12px}.item strong{overflow-wrap:anywhere}.item small{display:block;margin-top:4px;color:#8b5040}.actions{display:flex;flex-wrap:wrap;gap:8px}.error{color:#8d3f34;font-weight:750}@media(max-width:600px){.settings-page{padding:18px}.create{align-items:stretch;flex-direction:column}.item{align-items:stretch;flex-direction:column}.actions .button{width:100%}}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid #d46d42;outline-offset:3px}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}`}</style>
      <div className="shell">
        <div className="toolbar" aria-label={copy.languageLabel}><span>{copy.languageLabel}</span>{(["en", "es"] as const).map((candidate) => <button className="locale" key={candidate} type="button" aria-pressed={locale === candidate} onClick={() => setLocale(candidate)}>{candidate === "en" ? copy.localeEnglish : copy.localeSpanish}</button>)}</div>
         <Link className="back" href={hrefFor(`/business/${businessId}/invoices`)}>{copy.brand} / {copy.title}</Link>
        <section className="card" aria-labelledby="categories-title">
          <p className="eyebrow">{copy.eyebrow}</p><h1 id="categories-title">{copy.title}</h1><p className="description">{copy.description}</p>
          <form className="create" onSubmit={(event) => void create(event)} aria-describedby={error ? "categories-error" : undefined}>
            <label htmlFor="category-name" className="sr-only">{copy.nameLabel}</label>
            <input id="category-name" name="categoryName" value={name} onChange={(event) => setName(event.target.value)} placeholder={copy.namePlaceholder} disabled={busy} />
            <button className="button" type="submit" disabled={busy}>{busy ? copy.creating : copy.create}</button>
          </form>
          {error && <p id="categories-error" className="error" role="alert">{error}</p>}
          {categories.length === 0 ? <p>{copy.empty}</p> : <div className="items" aria-label={copy.title}>{categories.map((category) => <article className="item" key={category.id}><div><strong>{category.name}</strong>{!category.isActive && <small>{copy.inactive}</small>}</div><div className="actions"><button className="button secondary" type="button" onClick={() => rename(category)} disabled={busy}>{copy.rename}</button>{category.isActive && <button className="button secondary" type="button" onClick={() => void mutate(category)} disabled={busy}>{copy.deactivate}</button>}</div></article>)}</div>}
        </section>
      </div>
    </main>
  );
}
