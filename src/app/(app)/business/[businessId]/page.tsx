import Link from "next/link";
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
    ? { eyebrow: "Resumen del negocio", documents: "Documentos", review: "Facturas por revisar", recent: "Cargas recientes", noRecent: "Aún no hay nada aquí.", noRecentHint: "Haz una foto a una factura o súbela desde el ordenador y aparecerá en esta lista.", add: "Subir fotos de facturas", status: "Estado", active: "Activo", inactive: "Inactivo" }
    : { eyebrow: "Business overview", documents: "Documents", review: "Invoices needing review", recent: "Recent uploads", noRecent: "Nothing here yet.", noRecentHint: "Take a photo of an invoice or add one from your computer and it will appear in this list.", add: "Add invoice photos", status: "Status", active: "Active", inactive: "Inactive" };

  const hrefFor = (path: string) => `/business/${businessId}${path}?locale=${locale}`;

  return (
    <section className="dashboard-page" aria-labelledby="dashboard-title">
      <style>{`.dashboard-page{max-width:900px}.dashboard-hero{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;padding:clamp(24px,5vw,44px);border-radius:22px;background:#17313b;color:#fff}.dashboard-hero h1{margin:0;font-size:clamp(2.2rem,6vw,4.6rem);line-height:.95;letter-spacing:-.065em;overflow-wrap:anywhere}.dashboard-eyebrow{margin:0 0 12px;color:#a8d5c9;font-size:.74rem;font-weight:850;letter-spacing:.14em;text-transform:uppercase}.dashboard-role{color:#d9e8e2;font-size:.85rem;text-transform:capitalize}.metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:18px 0}.metric{padding:20px;border:1px solid #cbd9d5;border-radius:16px;background:#fff}.metric strong{display:block;color:#0b6b66;font-size:clamp(2rem,5vw,3.4rem);line-height:1}.metric span{display:block;margin-top:8px;color:#49636b;font-weight:750;line-height:1.35}.uploads{padding:20px;border:1px solid #cbd9d5;border-radius:16px;background:#fff}.uploads h2{margin:0 0 14px;font-size:1.2rem}.upload-list{display:grid;gap:8px;margin:0;padding:0;list-style:none}.upload-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;padding:12px 0;border-top:1px solid #e2ebe7}.upload-row strong{display:block;overflow-wrap:anywhere}.upload-row small{color:#647876}.dashboard-cta{display:inline-flex;align-items:center;min-height:44px;margin-top:8px;padding:0 16px;border-radius:9px;background:#fff;color:#075b57;font-weight:800;text-decoration:none;white-space:nowrap}.dashboard-cta:hover{background:#d9eeea}.dashboard-cta:focus-visible{outline:3px solid #fff;outline-offset:3px}a.metric{display:block;color:inherit;text-decoration:none;transition:border-color .18s ease,transform .18s ease}a.metric:hover{border-color:#0b7772;transform:translateY(-1px)}.dashboard-empty{display:grid;justify-items:center;gap:6px;padding:22px 12px;border:1px dashed #b9cfc8;border-radius:12px;text-align:center}.dashboard-empty strong{color:#17313b}.dashboard-empty p{margin:0;max-width:34rem;color:#647876;line-height:1.5}@media(max-width:600px){.dashboard-hero{display:block}.metrics{grid-template-columns:1fr}.upload-row{grid-template-columns:1fr}}`}</style>
      <header className="dashboard-hero"><div><p className="dashboard-eyebrow">{copy.eyebrow}</p><h1 id="dashboard-title">{dashboard.business.name}</h1><p className="dashboard-role">{dashboard.business.role.replace("_", " ")} <StatusBadge label={dashboard.business.isActive ? copy.active : copy.inactive} tone={dashboard.business.isActive ? "active" : "inactive"} /></p></div><Link className="dashboard-cta" href={hrefFor("/upload")}>{copy.add}</Link></header>
      <div className="metrics"><Link className="metric" href={hrefFor("/documents")}><strong>{dashboard.documentCount}</strong><span>{copy.documents}</span></Link><Link className="metric" href={hrefFor("/invoices")}><strong>{dashboard.invoicesNeedingReview}</strong><span>{copy.review}</span></Link></div>
      <section className="uploads" aria-labelledby="recent-uploads-title"><h2 id="recent-uploads-title">{copy.recent}</h2>{dashboard.recentUploads.length === 0 ? <div className="dashboard-empty"><strong>{copy.noRecent}</strong><p>{copy.noRecentHint}</p></div> : <ul className="upload-list">{dashboard.recentUploads.map((upload) => <li className="upload-row" key={upload.id}><div><strong>{upload.originalFileName}</strong><small>{upload.createdAt}</small></div><span><small>{copy.status}: {upload.status}</small></span></li>)}</ul>}</section>
    </section>
  );
}
