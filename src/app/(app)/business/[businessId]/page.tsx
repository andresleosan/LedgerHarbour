import { redirect } from "next/navigation";

import { getCurrentIdentity } from "@/modules/auth/session";
import { getBusinessDashboard } from "@/modules/tenancy/portfolio-service";
import type { BusinessId } from "@/modules/tenancy/types";
import { BusinessLifecycleError, LIFECYCLE_ERROR_CODES } from "@/modules/tenancy/business-lifecycle-service";
import { AUTHORIZATION_ERROR_CODES, AuthorizationError } from "@/modules/permissions/authorize";
import { getPersistenceContext } from "@/modules/persistence/repository-factory";
import StatusBadge from "@/ui/StatusBadge";

export default async function BusinessDashboardPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams?: Promise<{ locale?: string }> }) {
  const identity = await getCurrentIdentity();
  if (!identity) redirect("/login");
  const { businessId } = await params;
  const locale = (await searchParams)?.locale === "es" ? "es" : "en";
  const persistence = getPersistenceContext();
  let dashboard;
  try {
    dashboard = await getBusinessDashboard(businessId as BusinessId, identity, {
      tenancyRepository: persistence.tenancyRepository,
      documentRepository: persistence.documentRepository,
      invoiceRepository: persistence.invoiceRepository,
    });
  } catch (error) {
    if (!((error instanceof AuthorizationError && error.code === AUTHORIZATION_ERROR_CODES.BUSINESS_ACCESS_DENIED) || (error instanceof BusinessLifecycleError && (error.code === LIFECYCLE_ERROR_CODES.BUSINESS_NOT_FOUND || error.code === LIFECYCLE_ERROR_CODES.INACTIVE_BUSINESS)))) throw error;
    redirect("/portfolio");
  }

  const copy = locale === "es"
    ? { eyebrow: "Resumen del negocio", documents: "Documentos", review: "Facturas por revisar", recent: "Cargas recientes", noRecent: "No hay cargas recientes.", status: "Estado", active: "Activo", inactive: "Inactivo" }
    : { eyebrow: "Business overview", documents: "Documents", review: "Invoices needing review", recent: "Recent uploads", noRecent: "No recent uploads.", status: "Status", active: "Active", inactive: "Inactive" };

  return (
    <section className="dashboard-page" aria-labelledby="dashboard-title">
      <style>{`.dashboard-page{max-width:900px}.dashboard-hero{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;padding:clamp(24px,5vw,44px);border-radius:22px;background:#17313b;color:#fff}.dashboard-hero h1{margin:0;font-size:clamp(2.2rem,6vw,4.6rem);line-height:.95;letter-spacing:-.065em;overflow-wrap:anywhere}.dashboard-eyebrow{margin:0 0 12px;color:#a8d5c9;font-size:.74rem;font-weight:850;letter-spacing:.14em;text-transform:uppercase}.dashboard-role{color:#d9e8e2;font-size:.85rem;text-transform:capitalize}.metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:18px 0}.metric{padding:20px;border:1px solid #cbd9d5;border-radius:16px;background:#fff}.metric strong{display:block;color:#0b6b66;font-size:clamp(2rem,5vw,3.4rem);line-height:1}.metric span{display:block;margin-top:8px;color:#49636b;font-weight:750;line-height:1.35}.uploads{padding:20px;border:1px solid #cbd9d5;border-radius:16px;background:#fff}.uploads h2{margin:0 0 14px;font-size:1.2rem}.upload-list{display:grid;gap:8px;margin:0;padding:0;list-style:none}.upload-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;padding:12px 0;border-top:1px solid #e2ebe7}.upload-row strong{display:block;overflow-wrap:anywhere}.upload-row small{color:#647876}.dashboard-empty{color:#647876}@media(max-width:600px){.dashboard-hero{display:block}.metrics{grid-template-columns:1fr}.upload-row{grid-template-columns:1fr}}`}</style>
      <header className="dashboard-hero"><div><p className="dashboard-eyebrow">{copy.eyebrow}</p><h1 id="dashboard-title">{dashboard.business.name}</h1><p className="dashboard-role">{dashboard.business.role.replace("_", " ")} <StatusBadge label={dashboard.business.isActive ? copy.active : copy.inactive} tone={dashboard.business.isActive ? "active" : "inactive"} /></p></div></header>
      <div className="metrics"><article className="metric"><strong>{dashboard.documentCount}</strong><span>{copy.documents}</span></article><article className="metric"><strong>{dashboard.invoicesNeedingReview}</strong><span>{copy.review}</span></article></div>
      <section className="uploads" aria-labelledby="recent-uploads-title"><h2 id="recent-uploads-title">{copy.recent}</h2>{dashboard.recentUploads.length === 0 ? <p className="dashboard-empty">{copy.noRecent}</p> : <ul className="upload-list">{dashboard.recentUploads.map((upload) => <li className="upload-row" key={upload.id}><div><strong>{upload.originalFileName}</strong><small>{upload.createdAt}</small></div><span><small>{copy.status}: {upload.status}</small></span></li>)}</ul>}</section>
    </section>
  );
}
