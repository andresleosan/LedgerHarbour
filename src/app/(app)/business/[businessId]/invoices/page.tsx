import Link from "next/link";

import { getCurrentIdentity } from "@/modules/auth/session";
import { listInvoices, type InvoiceListItem } from "@/modules/invoices/invoice-review-service";
import { messages, type SupportedLocale } from "@/i18n/config";
import type { BusinessId } from "@/modules/tenancy/types";
import { getPersistenceContext } from "@/modules/persistence/repository-factory";
import { BusinessLifecycleError, LIFECYCLE_ERROR_CODES } from "@/modules/tenancy/business-lifecycle-service";
import { AUTHORIZATION_ERROR_CODES, AuthorizationError } from "@/modules/permissions/authorize";

type Filter = "all" | "needs_review" | "approved" | "failed";

export default async function InvoicesPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams?: Promise<{ status?: string; locale?: string }> }) {
  const { businessId } = await params;
  const query = await searchParams;
  const locale: SupportedLocale = query?.locale === "es" ? "es" : "en";
  const filter: Filter = query?.status === "needs_review" || query?.status === "approved" || query?.status === "failed" ? query.status : "all";
  const preservedQuery = new URLSearchParams({ locale });
  if (query?.status) preservedQuery.set("status", query.status);
  const copy = messages[locale].invoices;
  let invoices: InvoiceListItem[] = [];
  let listError: "business_unavailable" | null = null;
  const identity = getCurrentIdentity();
  if (identity) {
    const persistence = getPersistenceContext();
    try {
      invoices = await listInvoices(businessId as BusinessId, identity, {
        tenancyRepository: persistence.tenancyRepository,
        documentRepository: persistence.documentRepository,
        invoices: persistence.invoiceRepository,
      });
    } catch (error) {
      if ((error instanceof BusinessLifecycleError && error.code === LIFECYCLE_ERROR_CODES.BUSINESS_NOT_FOUND) || (error instanceof AuthorizationError && error.code === AUTHORIZATION_ERROR_CODES.BUSINESS_ACCESS_DENIED)) {
        listError = "business_unavailable";
      } else {
        throw error;
      }
    }
  }
  const visible = filter === "all" ? invoices : invoices.filter((invoice) => filter === invoice.reviewState || (filter === "failed" && invoice.documentStatus === "failed"));
  const filters: Array<[Filter, string]> = [["all", copy.allInvoices], ["needs_review", copy.needsReview], ["approved", copy.approvedFilter], ["failed", copy.failed]];
  const statusLabel = (invoice: InvoiceListItem) => invoice.documentStatus === "failed" ? copy.failed : invoice.reviewState === "needs_review" ? copy.needsReview : invoice.reviewState === "approved" ? copy.approvedFilter : invoice.reviewState;

  return (
     <main className="invoice-list-page"><style>{`button:focus-visible,a:focus-visible{outline:3px solid #e47d6c;outline-offset:3px}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}`}</style>
      <style>{`*{box-sizing:border-box}body{margin:0;background:#f7f8f5;color:#17313b;font-family:Inter,ui-sans-serif,system-ui,sans-serif}.invoice-list-page{min-height:100vh;padding:24px;background:linear-gradient(135deg,#f7f8f5 0%,#edf3ef 100%)}.shell{width:min(100%,1040px);margin:auto}.toolbar{display:flex;justify-content:flex-end;gap:8px;align-items:center;color:#49636b;font-size:.82rem}.locale{border:1px solid transparent;border-radius:999px;padding:8px 12px;background:transparent;color:#315b60;cursor:pointer;font:inherit;font-weight:750}.locale[aria-pressed=true]{border-color:#91b9ad;background:#fff;color:#0b6b66}.back{display:inline-block;margin-top:48px;color:#0b6b66;font-weight:800}.hero{display:flex;justify-content:space-between;gap:28px;align-items:end;margin-top:20px;padding:34px;border-radius:24px;background:#17313b;color:#fff;box-shadow:0 20px 45px #17313b1c}.eyebrow{margin:0 0 12px;color:#a8d5c9;font-size:.75rem;font-weight:850;letter-spacing:.14em;text-transform:uppercase}.hero h1{margin:0;font-size:clamp(2.4rem,6vw,5rem);line-height:.95;letter-spacing:-.06em}.hero p{max-width:620px;color:#d9e8e2;line-height:1.6}.settings{display:flex;flex-wrap:wrap;gap:10px}.settings a{padding:10px 13px;border:1px solid #9acabd;border-radius:10px;color:#fff;text-decoration:none;font-weight:750;transition:background-color .18s ease}.settings a:hover{background:#315b60}.filters{display:flex;flex-wrap:wrap;gap:9px;margin:24px 0}.filter{min-height:44px;border:1px solid #a9c4bc;border-radius:10px;padding:0 14px;background:#fff;color:#315b60;cursor:pointer;font:inherit;font-weight:750}.filter[aria-pressed=true]{border-color:#0b6b66;background:#d7eee8;color:#075b57}.empty{padding:42px;border:1px dashed #9ebdb5;border-radius:18px;background:#fff;color:#49636b;text-align:center}.empty strong{display:block;margin-bottom:8px;color:#17313b}.invoice-list{display:grid;gap:10px}.invoice-row{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:17px;border:1px solid #c6d8d0;border-radius:14px;background:#fff}.invoice-row p{margin:.35rem 0 0;color:#49636b}.invoice-row a{color:#0b6b66;font-weight:800}button:focus-visible,a:focus-visible{outline:3px solid #d46d42;outline-offset:3px}@media(max-width:700px){.invoice-list-page{padding:18px}.hero{align-items:stretch;flex-direction:column;padding:24px}.settings a{flex:1}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}`}</style>
      <div className="shell">
        <div className="toolbar" aria-label={copy.languageLabel}><span>{copy.languageLabel}</span>{(["en", "es"] as const).map((candidate) => <form key={candidate} method="get"><input type="hidden" name="status" value={filter} /><button className="locale" type="submit" name="locale" value={candidate} aria-pressed={locale === candidate}>{candidate === "en" ? copy.localeEnglish : copy.localeSpanish}</button></form>)}</div>
         <Link className="back" href={`/business/${businessId}/members?${preservedQuery.toString()}`}>LedgerHarbour / {copy.listTitle}</Link>
         <section className="hero" aria-labelledby="invoice-list-title"><div><p className="eyebrow">{copy.title}</p><h1 id="invoice-list-title">{copy.listTitle}</h1><p>{copy.listDescription}</p></div><nav className="settings" aria-label="Finance settings"><Link href={`/business/${businessId}/settings/categories?${preservedQuery.toString()}`}>{messages[locale].categories.title}</Link><Link href={`/business/${businessId}/settings/currencies?${preservedQuery.toString()}`}>{messages[locale].currencies.title}</Link></nav></section>
        <div className="filters" role="group" aria-label={copy.listTitle}>{filters.map(([value, label]) => <form key={value} method="get"><input type="hidden" name="locale" value={locale} /><button className="filter" type="submit" name="status" value={value} aria-pressed={filter === value}>{label}</button></form>)}</div>
          {listError ? <section className="empty" role="alert"><strong>{copy.loadError}</strong></section> : visible.length === 0 ? <section className="empty" aria-live="polite"><strong>{copy.empty}</strong><span>{filter === "all" ? copy.allInvoices : filters.find(([value]) => value === filter)?.[1]}</span></section> : <section className="invoice-list" aria-label={copy.listTitle}>{visible.map((invoice) => <article className="invoice-row" key={invoice.id}><div><strong>{invoice.supplier ?? invoice.invoiceNumber ?? invoice.id}</strong><p>{statusLabel(invoice)}</p></div><Link href={`/business/${businessId}/invoices/${invoice.id}?${preservedQuery.toString()}`}>{copy.openReview}</Link></article>)}</section>}
      </div>
    </main>
  );
}
