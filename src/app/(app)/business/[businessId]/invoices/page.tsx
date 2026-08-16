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
  const identity = await getCurrentIdentity();
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
    <main className="operational-page invoice-list-page">
      <div className="page-shell invoice-shell">
        <Link className="page-back" href={`/business/${businessId}/members?${preservedQuery.toString()}`}>LedgerHarbour / {copy.listTitle}</Link>
        <section className="invoice-hero" aria-labelledby="invoice-list-title">
          <div><p className="page-eyebrow">{copy.title}</p><h1 className="page-title" id="invoice-list-title">{copy.listTitle}</h1><p className="page-description">{copy.listDescription}</p></div>
          <nav className="invoice-settings" aria-label={messages[locale].categories.eyebrow}><Link href={`/business/${businessId}/settings/categories?${preservedQuery.toString()}`}>{messages[locale].categories.title}</Link><Link href={`/business/${businessId}/settings/currencies?${preservedQuery.toString()}`}>{messages[locale].currencies.title}</Link></nav>
        </section>
        <div className="invoice-filters" role="group" aria-label={copy.listTitle}>{filters.map(([value, label]) => <form key={value} method="get"><input type="hidden" name="locale" value={locale} /><button className="filter-button" type="submit" name="status" value={value} aria-pressed={filter === value}>{label}</button></form>)}</div>
        {listError ? <section className="page-card page-empty" role="alert"><strong>{copy.loadError}</strong></section> : visible.length === 0 ? <section className="page-card page-empty" aria-live="polite"><strong>{copy.empty}</strong><span>{filter === "all" ? copy.allInvoices : filters.find(([value]) => value === filter)?.[1]}</span></section> : <section className="invoice-list" aria-label={copy.listTitle}>{visible.map((invoice) => <article className="invoice-row" key={invoice.id}><div><strong>{invoice.supplier ?? invoice.invoiceNumber ?? invoice.id}</strong><p>{statusLabel(invoice)}</p></div><Link className="tertiary-button" href={`/business/${businessId}/invoices/${invoice.id}?${preservedQuery.toString()}`}>{copy.openReview}</Link></article>)}</section>}
      </div>
    </main>
  );
}
