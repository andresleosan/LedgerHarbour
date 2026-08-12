"use client";

import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import type { AuthIdentity } from "@/modules/auth/auth-provider";
import type { BusinessSummary } from "@/modules/tenancy/portfolio-service";
import BusinessSwitcher from "@/ui/BusinessSwitcher";
import LanguageSwitcher from "@/ui/LanguageSwitcher";

interface AppShellProps {
  children: ReactNode;
  identity: AuthIdentity;
  businesses: readonly BusinessSummary[];
  locale: "en" | "es";
  signOutAction: (formData: FormData) => void | Promise<void>;
}

export default function AppShell({ children, identity, businesses, locale, signOutAction }: AppShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeLocale = searchParams.get("locale") === "es" ? "es" : locale;
  const businessIdFromPath = pathname.match(/^\/business\/([^/]+)/)?.[1];
  const activeBusiness = businesses.find((business) => business.isActive && business.id === businessIdFromPath)
    ?? (pathname === "/portfolio" ? businesses.find((business) => business.isActive) : undefined);
  const hrefFor = (targetPath: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("locale", activeLocale);
    return `${targetPath}?${params.toString()}`;
  };
  const copy = activeLocale === "es"
    ? {
        portfolio: "Portfolio",
        upload: "Cargar",
        invoices: "Facturas / revisión",
        documents: "Documentos",
        unavailable: "No disponible aún",
        settings: "Configuración",
        signOut: "Cerrar sesión",
        workspace: "Espacio de trabajo",
      }
    : {
        portfolio: "Portfolio",
        upload: "Upload",
        invoices: "Invoices / review",
        documents: "Documents",
        unavailable: "Not available yet",
        settings: "Settings",
        signOut: "Sign out",
        workspace: "Workspace",
      };

  return (
    <div className="app-shell">
      <style>{`
        :root { color-scheme: light; }
        * { box-sizing: border-box; }
        body { margin: 0; background: #f4f7f4; color: #17313b; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
        a { color: inherit; }
        .app-shell { min-height: 100vh; background: radial-gradient(circle at 90% 0%, #dff0e9 0, transparent 28%), #f4f7f4; }
        .shell-header { display: grid; grid-template-columns: minmax(190px, 220px) 1fr auto; gap: 24px; align-items: center; width: min(100% - 40px, 1240px); margin: 0 auto; padding: 22px 0; border-bottom: 1px solid #d6e1dc; }
        .shell-brand { color: #17313b; font-weight: 850; letter-spacing: .02em; text-decoration: none; }
        .shell-brand-mark { display: inline-grid; place-items: center; width: 30px; height: 30px; margin-right: 9px; border: 1px solid #0b7772; border-radius: 9px; color: #0b7772; font-size: .72rem; }
        .shell-nav { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .shell-nav a, .shell-nav-disabled { min-height: 40px; display: inline-flex; align-items: center; border-radius: 9px; padding: 0 10px; color: #49636b; font-size: .86rem; font-weight: 750; text-decoration: none; }
        .shell-nav a:hover, .shell-nav a[aria-current="page"] { background: #d9eeea; color: #075b57; }
        .shell-nav-disabled { cursor: not-allowed; opacity: .6; }
        .shell-user { display: flex; align-items: center; justify-content: flex-end; gap: 12px; color: #49636b; font-size: .78rem; }
        .shell-user strong { display: block; color: #17313b; font-size: .84rem; }
        .sign-out { border: 1px solid #9bb7b0; border-radius: 8px; padding: 8px 10px; background: #fff; color: #315b60; cursor: pointer; font: inherit; font-size: .78rem; font-weight: 800; }
        .shell-main { width: min(100% - 40px, 1240px); margin: 0 auto; padding: 26px 0 60px; }
        .shell-layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 28px; align-items: start; }
        .business-switcher { position: sticky; top: 18px; padding: 16px; border: 1px solid #d2e0da; border-radius: 16px; background: #fff; box-shadow: 0 12px 30px rgba(23,49,59,.06); }
        .shell-label { margin: 0 0 10px; color: #55716f; font-size: .72rem; font-weight: 850; letter-spacing: .1em; text-transform: uppercase; }
        .business-list { display: grid; gap: 7px; }
        .business-option a, .business-option-disabled { display: block; padding: 10px; border-radius: 10px; text-decoration: none; }
        .business-option a:hover { background: #edf7f3; }
        .business-option-disabled { background: #f4f6f4; cursor: not-allowed; }
        .business-option-name { display: block; overflow-wrap: anywhere; font-size: .85rem; font-weight: 800; }
         .business-option-meta { display: flex; align-items: center; justify-content: space-between; gap: 5px; margin-top: 6px; color: #536b69; font-size: .7rem; text-transform: capitalize; }
        .status-badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 3px 7px; font-size: .66rem; font-weight: 850; text-transform: none; }
        .status-badge-active { background: #d9eeea; color: #075b57; }
        .status-badge-inactive { background: #f4dbd2; color: #793e35; }
        .status-badge-neutral { background: #e8efed; color: #49636b; }
        .language-switcher { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-bottom: 20px; color: #55716f; font-size: .78rem; }
        .language-switcher a { border-radius: 7px; padding: 6px 7px; color: #315b60; font-weight: 800; text-decoration: none; }
        .language-switcher a:hover, .language-switcher a[aria-current="page"] { background: #d9eeea; color: #075b57; }
        button:focus, a:focus { outline: 3px solid #d46d42; outline-offset: 3px; }
        @media (max-width: 900px) { .shell-header { grid-template-columns: 1fr auto; } .shell-nav { grid-column: 1 / -1; grid-row: 2; } }
        @media (max-width: 650px) { .shell-header, .shell-main { width: min(100% - 28px, 1240px); } .shell-header { gap: 12px; } .shell-user span { display: none; } .shell-layout { grid-template-columns: 1fr; gap: 18px; } .business-switcher { position: static; order: 2; } .shell-content { order: 1; } .shell-nav { overflow-x: auto; flex-wrap: nowrap; } .shell-nav a, .shell-nav-disabled { white-space: nowrap; } }
        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; } }
      `}</style>
      <header className="shell-header">
         <a className="shell-brand" href={hrefFor("/portfolio")}><span className="shell-brand-mark" aria-hidden="true">LH</span>LedgerHarbour</a>
         <nav className="shell-nav" aria-label={copy.workspace}>
           <a href={hrefFor("/portfolio")} aria-current={pathname === "/portfolio" ? "page" : undefined}>{copy.portfolio}</a>
           {activeBusiness ? <a href={hrefFor(`/business/${activeBusiness.id}/upload`)}>{copy.upload}</a> : <span className="shell-nav-disabled">{copy.upload}</span>}
           {activeBusiness ? <a href={hrefFor(`/business/${activeBusiness.id}/invoices`)}>{copy.invoices}</a> : <span className="shell-nav-disabled">{copy.invoices}</span>}
           <span className="shell-nav-disabled" aria-disabled="true" title={copy.unavailable}>{copy.documents}</span>
           {activeBusiness ? <a href={hrefFor(`/business/${activeBusiness.id}/settings/members`)}>{copy.settings}</a> : <span className="shell-nav-disabled">{copy.settings}</span>}
        </nav>
        <div className="shell-user"><span><strong>{identity.displayName}</strong>{identity.email}</span><form action={signOutAction}><button className="sign-out" type="submit">{copy.signOut}</button></form></div>
      </header>
      <main className="shell-main"><LanguageSwitcher locale={activeLocale} /><div className="shell-layout"><BusinessSwitcher businesses={businesses} locale={activeLocale} /><div className="shell-content">{children}</div></div></main>
    </div>
  );
}
