"use client";

import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import type { AuthIdentity } from "@/modules/auth/auth-provider";
import { signOutFirebaseUser, type FirebaseClientConfig } from "@/modules/auth/firebase-client";
import type { BusinessSummary } from "@/modules/tenancy/portfolio-service";
import BusinessSwitcher from "@/ui/BusinessSwitcher";
import LanguageSwitcher from "@/ui/LanguageSwitcher";

interface AppShellProps {
  children: ReactNode;
  identity: AuthIdentity;
  businesses: readonly BusinessSummary[];
  locale: "en" | "es";
  firebaseConfig?: FirebaseClientConfig;
  signOutAction: (formData: FormData) => void | Promise<void>;
}

export default function AppShell({ children, identity, businesses, locale, firebaseConfig, signOutAction }: AppShellProps) {
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
         body { margin: 0; background: #f7f8f5; color: #17313b; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
        a { color: inherit; }
        .app-shell { --lh-navy: #17313b; --lh-teal: #0b7772; --lh-teal-dark: #075b57; --lh-off-white: #f7f8f5; --lh-surface: #fff; --lh-border: #cbd9d5; --lh-muted: #49636b; --lh-coral: #d46d42; --lh-coral-focus: #8b452f; --lh-danger: #913f35; min-height: 100vh; background: radial-gradient(circle at 90% 0%, #e0f0e9 0, transparent 28%), var(--lh-off-white); }
        .shell-header { display: grid; grid-template-columns: minmax(190px, 220px) 1fr auto; gap: 24px; align-items: center; width: min(100% - 40px, 1240px); margin: 0 auto; padding: 22px 0; border-bottom: 1px solid #d6e1dc; }
        .shell-brand { color: #17313b; font-weight: 850; letter-spacing: .02em; text-decoration: none; }
        .shell-brand-mark { display: inline-grid; place-items: center; width: 30px; height: 30px; margin-right: 9px; border: 1px solid #0b7772; border-radius: 9px; color: #0b7772; font-size: .72rem; }
        .shell-nav { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .shell-nav a, .shell-nav-disabled { min-height: 40px; display: inline-flex; align-items: center; border-radius: 9px; padding: 0 10px; color: #49636b; font-size: .86rem; font-weight: 750; text-decoration: none; }
        .shell-nav a:hover, .shell-nav a[aria-current="page"] { background: #d9eeea; color: #075b57; }
        .shell-nav-disabled { cursor: not-allowed; opacity: .6; }
         .shell-user { display: flex; align-items: center; justify-content: flex-end; gap: 14px; color: #49636b; font-size: .78rem; }
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
         .language-switcher { display: inline-flex; align-items: center; gap: 2px; padding: 3px; border: 1px solid #9bb7b0; border-radius: 999px; background: #fff; transition: background-color .18s ease, border-color .18s ease; }
         .language-switcher a { border-radius: 999px; padding: 6px 8px; color: #315b60; font-size: .76rem; font-weight: 800; text-decoration: none; }
         .language-switcher a:hover, .language-switcher a[aria-current="page"] { background: #d9eeea; color: #075b57; }
         .language-switcher a:focus-visible, .app-shell button:focus-visible, .app-shell a:focus-visible, .app-shell input:focus-visible, .app-shell textarea:focus-visible { outline: 3px solid var(--lh-coral-focus); outline-offset: 3px; }
         .operational-page { min-width: 0; }
         .page-shell { width: min(100%, 980px); margin: 0 auto; }
         .page-back { display: inline-flex; margin-bottom: 20px; color: var(--lh-teal); font-weight: 800; text-decoration: none; }
         .page-card { padding: clamp(22px, 4vw, 34px); border: 1px solid var(--lh-border); border-radius: 16px; background: var(--lh-surface); box-shadow: 0 14px 34px rgba(23, 49, 59, .07); }
         .page-eyebrow { margin: 0 0 10px; color: var(--lh-teal); font-size: .74rem; font-weight: 850; letter-spacing: .14em; text-transform: uppercase; }
         .page-title { margin: 0; color: var(--lh-navy); font-size: clamp(1.85rem, 4vw, 3.1rem); line-height: 1.05; letter-spacing: -.045em; overflow-wrap: anywhere; }
         .page-description { color: var(--lh-muted); line-height: 1.6; }
         .page-input, .page-textarea { width: 100%; min-height: 44px; border: 1px solid #9fbab1; border-radius: 9px; padding: 10px 12px; color: var(--lh-navy); background: #fff; font: inherit; }
         .page-textarea { min-height: 82px; resize: vertical; }
         .primary-button, .secondary-button, .tertiary-button { min-height: 44px; border: 1px solid var(--lh-teal); border-radius: 9px; padding: 0 14px; cursor: pointer; font: inherit; font-weight: 800; transition: transform .18s ease, background-color .18s ease, border-color .18s ease; }
         .primary-button { background: var(--lh-teal); color: #fff; }
         .primary-button:hover { background: var(--lh-teal-dark); transform: translateY(-1px); }
         .secondary-button { border-color: #c48670; background: #fff7f2; color: #793e35; }
         .secondary-button:hover { background: #f4dbd2; }
         .tertiary-button { border-color: #8ba6a0; background: #fff; color: #315b60; }
         .tertiary-button:hover { background: #edf7f3; }
         .primary-button:disabled, .secondary-button:disabled, .tertiary-button:disabled, .sign-out:disabled { cursor: wait; opacity: .58; }
         .page-error { color: var(--lh-danger); font-weight: 750; }
         .page-feedback { color: var(--lh-teal-dark); font-weight: 750; }
         .page-empty { color: var(--lh-muted); }
         .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
         .upload-shell { max-width: 760px; }
         .upload-card { margin-top: 6px; }
         .upload-drop { display: grid; gap: 12px; margin-top: 24px; padding: 22px; border: 2px dashed #8db6b0; border-radius: 14px; background: #f5fbf8; }
         .upload-hint { margin: 0; font-size: .88rem; }
         .upload-drop button { justify-self: start; }
         .invoice-shell { max-width: 1040px; }
         .invoice-hero { display: flex; justify-content: space-between; gap: 24px; align-items: flex-end; margin-bottom: 22px; padding: 28px; border-radius: 16px; background: var(--lh-navy); color: #fff; }
         .invoice-hero .page-eyebrow { color: #a8d5c9; }
         .invoice-hero .page-title { color: #fff; }
         .invoice-hero .page-description { color: #d9e8e2; max-width: 620px; }
         .invoice-settings { display: flex; flex-wrap: wrap; gap: 8px; }
         .invoice-settings a { border: 1px solid #9acabd; border-radius: 9px; padding: 10px 12px; color: #fff; font-weight: 750; text-decoration: none; }
         .invoice-settings a:hover { background: #315b60; }
         .invoice-filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 18px; }
         .filter-button { min-height: 42px; border: 1px solid #a9c4bc; border-radius: 9px; padding: 0 13px; background: #fff; color: #315b60; cursor: pointer; font: inherit; font-weight: 750; }
         .filter-button[aria-pressed="true"] { border-color: var(--lh-teal); background: #d7eee8; color: var(--lh-teal-dark); }
         .invoice-list { display: grid; gap: 10px; }
         .invoice-row { display: flex; justify-content: space-between; align-items: center; gap: 14px; padding: 16px; border: 1px solid var(--lh-border); border-radius: 12px; background: #fff; }
         .invoice-row strong { overflow-wrap: anywhere; }
         .invoice-row p { margin: 5px 0 0; color: var(--lh-muted); font-size: .86rem; }
         .invoice-row a { display: inline-flex; align-items: center; color: #315b60; text-decoration: none; white-space: nowrap; }
         .review-shell { max-width: 1120px; }
         .review-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; }
         .review-preview { min-height: 500px; background: var(--lh-navy); color: #fff; }
         .review-preview .page-title { color: #fff; }
         .review-preview p { color: #d6e8e0; line-height: 1.6; }
         .review-preview a { display: inline-flex; align-items: center; color: #315b60; text-decoration: none; }
         .review-fields { display: grid; gap: 12px; margin-top: 20px; }
         .review-field { display: grid; gap: 6px; }
         .review-field label { font-weight: 750; }
         .low-confidence { border-color: #c77c52; background: #fff7ed; }
         .confidence { color: #8d4d2d; font-size: .78rem; }
         .review-actions, .page-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
         .review-actions button, .page-actions button { flex: 0 1 auto; }
         .members-shell { max-width: 820px; }
         .request-list, .settings-items, .settings-members-list { display: grid; gap: 10px; margin-top: 22px; }
         .request-row, .settings-item { display: flex; justify-content: space-between; align-items: center; gap: 14px; padding: 15px; border: 1px solid #d0ded8; border-radius: 12px; background: #fff; }
         .request-id, .request-role, .member-id, .member-role { margin: 0; }
         .request-id, .member-id { font-weight: 750; overflow-wrap: anywhere; }
         .request-role, .member-role { margin-top: 5px; color: var(--lh-muted); font-size: .86rem; }
         .settings-shell, .currency-shell, .settings-members-shell { max-width: 900px; }
         .settings-create, .currency-create { display: grid; gap: 9px; margin: 22px 0; }
         .settings-create { grid-template-columns: minmax(0, 1fr) auto; }
         .currency-create { grid-template-columns: 2fr 1fr 1fr 1fr auto; }
         .settings-item small { display: block; margin-top: 4px; color: var(--lh-muted); }
         .member-info { min-width: 0; }
         .transfer-panel { margin-top: 22px; padding: 18px; border: 1px solid #e1b9a8; border-radius: 12px; background: #fff6ef; }
         .transfer-panel h2 { margin: 0; font-size: 1.15rem; }
         .transfer-panel p { color: var(--lh-muted); line-height: 1.5; }
         .transfer-panel label, .danger-label { display: block; font-weight: 750; }
         .transfer-panel .page-input, .danger-label .page-input { margin-top: 7px; }
         .danger-shell { max-width: 720px; }
         .danger-card { border-color: #e1b9a8; }
         .danger-eyebrow { color: var(--lh-danger); }
         .danger-warning { padding: 15px; border-left: 4px solid #bb584b; background: #fff1eb; color: #6e382f; line-height: 1.55; }
         .danger-action { border-color: #bb584b; }
         @media (max-width: 900px) { .shell-header { grid-template-columns: 1fr auto; } .shell-nav { grid-column: 1 / -1; grid-row: 2; } }
         @media (max-width: 900px) { .currency-create { grid-template-columns: 1fr 1fr; } .currency-create input:first-of-type { grid-column: span 2; } }
         @media (max-width: 650px) { .shell-header, .shell-main { width: min(100% - 28px, 1240px); } .shell-header { gap: 12px; } .shell-user span { display: none; } .shell-layout { grid-template-columns: 1fr; gap: 18px; } .business-switcher { position: static; order: 2; } .shell-content { order: 1; } .shell-nav { overflow-x: auto; flex-wrap: nowrap; } .shell-nav a, .shell-nav-disabled { white-space: nowrap; } .page-shell { width: 100%; } .invoice-hero { display: block; } .invoice-settings { margin-top: 18px; } .review-grid { grid-template-columns: 1fr; } .review-preview { min-height: auto; } .request-row, .settings-item { align-items: stretch; flex-direction: column; } .page-actions { width: 100%; } .page-actions button { flex: 1 1 100%; } .settings-create, .currency-create { grid-template-columns: 1fr; } .currency-create input:first-of-type { grid-column: auto; } .upload-drop { padding: 18px; } }
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
         <div className="shell-user"><LanguageSwitcher locale={activeLocale} /><span><strong>{identity.displayName}</strong>{identity.email}</span><form action={signOutAction} onSubmit={async (event) => { event.preventDefault(); const form = event.currentTarget; try { await signOutFirebaseUser(firebaseConfig); } finally { await signOutAction(new FormData(form)); } }}><button className="sign-out" type="submit">{copy.signOut}</button></form></div>
       </header>
       <main className="shell-main"><div className="shell-layout"><BusinessSwitcher businesses={businesses} locale={activeLocale} /><div className="shell-content">{children}</div></div></main>
    </div>
  );
}
