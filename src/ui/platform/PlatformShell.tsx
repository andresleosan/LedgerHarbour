"use client";

import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import type { AuthIdentity } from "@/modules/auth/auth-provider";
import { signOutFirebaseUser, type FirebaseClientConfig } from "@/modules/auth/firebase-client";
import { messages } from "@/i18n/config";
import LanguageSwitcher from "@/ui/LanguageSwitcher";

interface PlatformShellProps {
  children: ReactNode;
  identity: AuthIdentity;
  locale: "en" | "es";
  firebaseConfig?: FirebaseClientConfig;
  signOutAction: () => Promise<never>;
}

export default function PlatformShell({ children, identity, locale, firebaseConfig, signOutAction }: PlatformShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeLocale = searchParams.get("locale") === "es" ? "es" : locale;
  const copy = messages[activeLocale].platform;

  return (
    <div className="platform-shell">
      <style>{`
        :root { color-scheme: light; }
        * { box-sizing: border-box; }
        body { margin: 0; background: #f7f8f5; color: #17313b; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
        a { color: inherit; }
        .platform-shell { --platform-ink: #17313b; --platform-teal: #0b7772; --platform-teal-dark: #075b57; --platform-muted: #49636b; --platform-border: #cbd9d5; --platform-surface: #fff; --platform-coral: #8b452f; min-height: 100vh; overflow-x: hidden; background: radial-gradient(circle at 90% 0%, #e0f0e9 0, transparent 30%), #f7f8f5; }
        .platform-header { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 22px; align-items: center; width: min(100% - 40px, 1240px); margin: 0 auto; padding: 20px 0; border-bottom: 1px solid #d6e1dc; }
        .platform-brand { display: inline-flex; align-items: center; gap: 10px; color: var(--platform-ink); font-weight: 850; letter-spacing: .02em; text-decoration: none; }
        .platform-brand-mark { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 10px; background: var(--platform-ink); color: #d9eeea; font-size: .78rem; letter-spacing: .08em; }
        .platform-nav { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
        .platform-nav a { min-height: 40px; display: inline-flex; align-items: center; border-radius: 9px; padding: 0 10px; color: var(--platform-muted); font-size: .86rem; font-weight: 750; text-decoration: none; }
        .platform-nav a:hover, .platform-nav a[aria-current="page"] { background: #d9eeea; color: var(--platform-teal-dark); }
        .platform-user { display: flex; align-items: center; justify-content: flex-end; gap: 12px; color: var(--platform-muted); font-size: .78rem; }
        .platform-user strong { display: block; color: var(--platform-ink); font-size: .84rem; }
        .platform-sign-out { border: 1px solid #9bb7b0; border-radius: 8px; padding: 8px 10px; background: #fff; color: #315b60; cursor: pointer; font: inherit; font-size: .78rem; font-weight: 800; }
        .platform-main { width: min(100% - 40px, 1240px); margin: 0 auto; padding: 30px 0 70px; }
        .platform-shell button:focus-visible, .platform-shell a:focus-visible, .platform-shell input:focus-visible, .platform-shell textarea:focus-visible, .platform-shell select:focus-visible { outline: 3px solid var(--platform-coral); outline-offset: 3px; }
        .platform-shell .language-switcher { display: inline-flex; align-items: center; gap: 2px; padding: 3px; border: 1px solid #9bb7b0; border-radius: 999px; background: #fff; }
        .platform-shell .language-switcher a { border-radius: 999px; padding: 6px 8px; color: #315b60; font-size: .76rem; font-weight: 800; text-decoration: none; }
        .platform-shell .language-switcher a:hover, .platform-shell .language-switcher a[aria-current="page"] { background: #d9eeea; color: var(--platform-teal-dark); }
        .platform-shell .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
        .platform-shell .platform-status { display: inline-flex; align-items: center; width: fit-content; border-radius: 999px; padding: 4px 8px; font-size: .68rem; font-weight: 850; }
        .platform-status-pending { background: #fff0ce; color: #76500a; }
        .platform-status-active { background: #d9eeea; color: #075b57; }
        .platform-status-suspended, .platform-status-rejected, .platform-status-revoked { background: #f4dbd2; color: #793e35; }
        .platform-status-neutral { background: #e8efed; color: #49636b; }
        .platform-dialog-backdrop { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 20px; background: rgba(23, 49, 59, .48); }
        .platform-dialog { width: min(100%, 520px); padding: 26px; border: 1px solid var(--platform-border); border-radius: 16px; background: #fff; box-shadow: 0 25px 80px rgba(23,49,59,.24); }
        .platform-dialog h2 { margin: 0; font-size: 1.4rem; letter-spacing: -.03em; }
        .platform-dialog p { color: var(--platform-muted); line-height: 1.55; }
        .platform-field { display: grid; gap: 7px; margin-top: 16px; color: var(--platform-ink); font-size: .86rem; font-weight: 750; }
        .platform-field input, .platform-field textarea { width: 100%; min-height: 44px; border: 1px solid #9fbab1; border-radius: 9px; padding: 10px 12px; color: var(--platform-ink); background: #fff; font: inherit; }
        .platform-field textarea { min-height: 90px; resize: vertical; }
        .platform-dialog-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 22px; }
        .platform-button { min-height: 42px; border: 1px solid var(--platform-teal); border-radius: 9px; padding: 0 13px; cursor: pointer; font: inherit; font-weight: 800; transition: background-color .18s ease, transform .18s ease; }
        .platform-button:hover { transform: translateY(-1px); }
        .platform-button-primary { background: var(--platform-teal); color: #fff; }
        .platform-button-primary:hover { background: var(--platform-teal-dark); }
        .platform-button-muted { border-color: #8ba6a0; background: #fff; color: #315b60; }
        .platform-button-danger { border-color: #c48670; background: #fff7f2; color: #793e35; }
        .platform-button-danger:hover { background: #f4dbd2; }
        @media (max-width: 900px) { .platform-header { grid-template-columns: auto 1fr; } .platform-nav { grid-column: 1 / -1; grid-row: 2; overflow-x: auto; flex-wrap: nowrap; } .platform-nav a { white-space: nowrap; } }
        @media (max-width: 650px) { .platform-header, .platform-main { width: min(100% - 28px, 1240px); } .platform-header { gap: 12px; } .platform-user > span { display: none; } .platform-brand-label { display: none; } .platform-main { padding-top: 22px; } .platform-dialog { padding: 22px; } .platform-dialog-actions > * { flex: 1 1 100%; } }
        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; } }
      `}</style>
      <header className="platform-header">
        <a className="platform-brand" href="/admin" aria-label={copy.brand}>
          <span className="platform-brand-mark" aria-hidden="true">LH</span>
          <span className="platform-brand-label">{copy.workspaceLabel}</span>
        </a>
        <nav className="platform-nav" aria-label={copy.navigationLabel}>
          <a href="/admin" aria-current={pathname === "/admin" ? "page" : undefined}>{copy.dashboard}</a>
          <a href="/admin/businesses" aria-current={pathname.startsWith("/admin/businesses") ? "page" : undefined}>{copy.businesses}</a>
          <a href="/admin/projects" aria-current={pathname.startsWith("/admin/projects") ? "page" : undefined}>{copy.projects}</a>
          <a href="/admin/administrators" aria-current={pathname.startsWith("/admin/administrators") ? "page" : undefined}>{copy.administrators}</a>
        </nav>
        <div className="platform-user">
          <LanguageSwitcher locale={activeLocale} labels={{ ariaLabel: copy.languageLabel, english: copy.localeEnglish, spanish: copy.localeSpanish }} />
          <span><strong>{identity.displayName}</strong>{identity.email}</span>
          <form action={signOutAction} onSubmit={async (event) => { event.preventDefault(); try { await signOutFirebaseUser(firebaseConfig); } finally { await signOutAction(); } }}>
            <button className="platform-sign-out" type="submit">{copy.signOut}</button>
          </form>
        </div>
      </header>
      <main className="platform-main">{children}</main>
    </div>
  );
}
