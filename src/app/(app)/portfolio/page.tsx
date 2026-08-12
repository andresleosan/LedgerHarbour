import Link from "next/link";

import { getCurrentIdentity } from "@/modules/auth/session";
import { listUserBusinesses } from "@/modules/tenancy/portfolio-service";
import StatusBadge from "@/ui/StatusBadge";

export default async function PortfolioPage({ searchParams }: { searchParams?: Promise<{ locale?: string }> }) {
  const identity = getCurrentIdentity();
  if (!identity) return null;
  const locale = (await searchParams)?.locale === "es" ? "es" : "en";
  const localeQuery = `?locale=${locale}`;
  const businesses = await listUserBusinesses(identity);
  const copy = locale === "es"
    ? { eyebrow: "Espacio multiempresa", title: "Portfolio", description: "Elige un negocio autorizado para continuar.", empty: "Aún no tienes negocios autorizados.", active: "Activo", inactive: "Inactivo", open: "Abrir negocio", role: "Rol" }
    : { eyebrow: "Multi-business workspace", title: "Portfolio", description: "Choose an authorized business to continue.", empty: "You do not have any authorized businesses yet.", active: "Active", inactive: "Inactive", open: "Open business", role: "Role" };

  return (
<section className="portfolio-page" aria-labelledby="portfolio-title">
      <style>{`.portfolio-page{max-width:900px}.portfolio-hero{padding:clamp(24px,5vw,48px);border-radius:22px;background:#17313b;color:#fff;box-shadow:0 18px 42px rgba(23,49,59,.14)}.portfolio-eyebrow{margin:0 0 12px;color:#a8d5c9;font-size:.74rem;font-weight:850;letter-spacing:.14em;text-transform:uppercase}.portfolio-hero h1{margin:0;font-size:clamp(2.5rem,7vw,5.8rem);line-height:.93;letter-spacing:-.07em}.portfolio-hero p:last-child{max-width:600px;margin:20px 0 0;color:#d9e8e2;line-height:1.6}.portfolio-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:20px}.business-card{min-height:180px;display:flex;flex-direction:column;justify-content:space-between;padding:20px;border:1px solid #cbd9d5;border-radius:16px;background:#fff;box-shadow:0 12px 30px rgba(23,49,59,.06)}.business-card-disabled{background:#f3f5f3;color:#647876}.business-card h2{margin:0;overflow-wrap:anywhere;font-size:1.2rem}.business-card-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#647876;font-size:.8rem}.business-card-link{color:#0b6b66;font-weight:850;text-decoration:underline;text-underline-offset:3px}.portfolio-empty{padding:26px;border:1px dashed #9ebdb5;border-radius:16px;background:#fff;color:#49636b}.portfolio-page a:focus-visible{outline:3px solid #d46d42;outline-offset:3px}@media(max-width:650px){.portfolio-grid{grid-template-columns:1fr}}`}</style>
       <div className="portfolio-hero"><p className="portfolio-eyebrow">{copy.eyebrow}</p><h1 id="portfolio-title">{copy.title}</h1><p>{copy.description}</p></div>
       {businesses.length === 0 ? <p className="portfolio-empty">{copy.empty}</p> : <div className="portfolio-grid">{businesses.map((business) => <article className={`business-card${business.isActive ? "" : " business-card-disabled"}`} aria-label={business.name} key={business.id}><div><h2>{business.name}</h2><div className="business-card-meta"><span>{copy.role}: {business.role.replace("_", " ")}</span><StatusBadge label={business.isActive ? copy.active : copy.inactive} tone={business.isActive ? "active" : "inactive"} /></div></div>{business.isActive ? <Link className="business-card-link" href={`/business/${business.id}${localeQuery}`}>{copy.open}</Link> : <span aria-disabled="true">{copy.inactive}</span>}</article>)}</div>}
    </section>
  );
}
