import Link from "next/link";

import { getCurrentIdentity } from "@/modules/auth/session";
import { DocumentError } from "@/modules/documents/document-service";
import { listDocuments, type DocumentListItem } from "@/modules/documents/document-list-service";
import { messages, type SupportedLocale } from "@/i18n/config";
import { getPersistenceContext } from "@/modules/persistence/repository-factory";
import type { BusinessId } from "@/modules/tenancy/types";

import DocumentActions from "./DocumentActions";

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams?: Promise<{ locale?: string }> }) {
  const { businessId } = await params;
  const locale: SupportedLocale = (await searchParams)?.locale === "es" ? "es" : "en";
  const copy = messages[locale].documentList;
  const query = `locale=${locale}`;
  let documents: DocumentListItem[] = [];
  let loadError = false;
  const identity = await getCurrentIdentity();
  if (identity) {
    const persistence = getPersistenceContext();
    try {
      documents = await listDocuments(businessId as BusinessId, identity, {
        tenancyRepository: persistence.tenancyRepository,
        documentRepository: persistence.documentRepository,
        invoices: persistence.invoiceRepository,
        jobs: persistence.jobRepository,
      });
    } catch (error) {
      if (!(error instanceof DocumentError)) throw error;
      loadError = true;
    }
  }
  const statusLabel: Record<DocumentListItem["status"], string> = {
    uploaded: copy.statusUploaded,
    processing: copy.statusProcessing,
    needs_review: copy.statusNeedsReview,
    approved: copy.statusApproved,
    failed: copy.statusFailed,
  };
  const date = new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

  return (
    <div className="operational-page document-list-page">
      <style>{`.document-row{flex-wrap:wrap}.document-row>div:first-child{flex:1 1 220px}.document-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}.document-actions-block .page-error{margin:8px 0 0}.document-empty-action{display:inline-flex;align-items:center;text-decoration:none}@media(max-width:650px){.document-row{flex-direction:column;align-items:stretch}.document-row>div:first-child{flex:none}.document-actions{justify-content:stretch}.document-actions>*{flex:1 1 100%;justify-content:center}}`}</style>
      <div className="page-shell invoice-shell">
        <Link className="page-back" href={`/business/${businessId}?${query}`}>LedgerHarbour / {copy.title}</Link>
        <section className="invoice-hero" aria-labelledby="document-list-title">
          <div><p className="page-eyebrow">{copy.eyebrow}</p><h1 className="page-title" id="document-list-title">{copy.title}</h1><p className="page-description">{copy.description}</p></div>
          <nav className="invoice-settings" aria-label={copy.title}><Link href={`/business/${businessId}/upload?${query}`}>{copy.upload}</Link></nav>
        </section>
        {loadError ? <section className="page-card page-empty" role="alert"><strong>{copy.loadError}</strong></section>
          : documents.length === 0 ? <section className="page-card page-empty" aria-live="polite"><p><strong>{copy.empty}</strong></p><Link className="primary-button document-empty-action" href={`/business/${businessId}/upload?${query}`}>{copy.upload}</Link></section>
          : <section className="invoice-list" aria-labelledby="document-list-title">{documents.map((document) => (
            <article className="invoice-row document-row" key={document.id}>
              <div>
                <strong>{document.originalFileName}</strong>
                <p><time dateTime={document.createdAt}>{copy.uploadedOn.replace("{date}", date.format(new Date(document.createdAt)))}</time> · {statusLabel[document.status]}</p>
                {document.status === "failed" && !document.canRetry && !document.invoiceId && <p>{copy.noAttemptsLeft}</p>}
              </div>
              <DocumentActions businessId={businessId} documentId={document.id} fileName={document.originalFileName} invoiceId={document.invoiceId} failed={document.status === "failed"} canRetry={document.canRetry} locale={locale} copy={copy} />
            </article>
          ))}</section>}
      </div>
    </div>
  );
}
