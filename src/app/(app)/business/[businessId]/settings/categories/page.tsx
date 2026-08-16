"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

import { messages } from "@/i18n/config";
import { useUrlLocale } from "@/ui/useUrlLocale";

type Category = { id: string; name: string; isActive: boolean };
type ErrorPayload = { error?: { code?: string } };

function messageForError(code: string | undefined, copy: typeof messages.en.categories): string {
  if (code === "CATEGORY_NAME_CONFLICT" || code === "CATEGORY_REPOSITORY_CONFLICT") return copy.conflictError;
  if (code === "INVALID_CATEGORY") return copy.invalidError;
  if (code === "BUSINESS_ACCESS_DENIED" || code === "INSUFFICIENT_CAPABILITY") return copy.accessError;
  if (code === "INACTIVE_BUSINESS") return copy.inactiveError;
  if (code === "CATEGORY_NOT_FOUND") return copy.notFoundError;
  return copy.networkError;
}

export default function CategoriesPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = use(params);
  const { locale, hrefFor } = useUrlLocale();
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
    setBusy(true); setError(null);
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
    setBusy(true); setError(null);
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
    <main className="operational-page settings-page">
      <div className="page-shell settings-shell">
        <Link className="page-back" href={hrefFor(`/business/${businessId}/invoices`)}>{copy.brand} / {copy.title}</Link>
        <section className="page-card" aria-labelledby="categories-title"><p className="page-eyebrow">{copy.eyebrow}</p><h1 className="page-title" id="categories-title">{copy.title}</h1><p className="page-description">{copy.description}</p>
          <form className="settings-create" onSubmit={(event) => void create(event)} aria-describedby={error ? "categories-error" : undefined}><label htmlFor="category-name" className="sr-only">{copy.nameLabel}</label><input className="page-input" id="category-name" name="categoryName" value={name} onChange={(event) => setName(event.target.value)} placeholder={copy.namePlaceholder} disabled={busy} /><button className="primary-button" type="submit" disabled={busy}>{busy ? copy.creating : copy.create}</button></form>
          {error && <p id="categories-error" className="page-error" role="alert">{error}</p>}
          {categories.length === 0 ? <p className="page-empty">{copy.empty}</p> : <div className="settings-items" aria-label={copy.title}>{categories.map((category) => <article className="settings-item" key={category.id}><div><strong>{category.name}</strong>{!category.isActive && <small>{copy.inactive}</small>}</div><div className="page-actions"><button className="secondary-button" type="button" onClick={() => rename(category)} disabled={busy}>{copy.rename}</button>{category.isActive && <button className="secondary-button" type="button" onClick={() => void mutate(category)} disabled={busy}>{copy.deactivate}</button>}</div></article>)}</div>}
        </section>
      </div>
    </main>
  );
}
