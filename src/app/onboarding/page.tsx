"use client";

import Link from "next/link";
import { useState } from "react";

import { messages, type SupportedLocale } from "@/i18n/config";

export default function OnboardingPage() {
  const [locale, setLocale] = useState<SupportedLocale>("en");
  const copy = messages[locale].onboarding;

  return (
    <main className="onboarding-page">
      <style>{`
        :root { color-scheme: light; }
        * { box-sizing: border-box; }
        body { margin: 0; background: #f8f4ec; color: #10283d; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
        a { color: inherit; }
        .onboarding-page { min-height: 100vh; padding: 28px; background: radial-gradient(circle at 85% 5%, rgba(49, 154, 145, .16), transparent 30%), #f8f4ec; }
        .onboarding-shell { width: min(100%, 920px); margin: 0 auto; }
        .toolbar { display: flex; justify-content: flex-end; gap: 10px; align-items: center; color: #4c6270; font-size: .82rem; }
        .locale-button { border: 0; border-radius: 7px; padding: 7px 9px; background: transparent; color: #4c6270; cursor: pointer; font: inherit; font-weight: 700; }
        .locale-button[aria-pressed="true"] { background: #d9eeea; color: #0b6663; }
        .intro { max-width: 700px; margin: 90px 0 42px; }
        .eyebrow { margin: 0 0 15px; color: #0b7772; font-size: .76rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
        h1 { margin: 0; color: #10283d; font-size: clamp(2.5rem, 7vw, 5.7rem); line-height: .98; letter-spacing: -.06em; }
        .description { max-width: 580px; margin: 22px 0 0; color: #536572; font-size: 1.06rem; line-height: 1.65; }
        .choice-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
        .choice { min-height: 210px; display: flex; flex-direction: column; justify-content: space-between; padding: 26px; border: 1px solid #cbd9d5; border-radius: 20px; background: #fffdf8; box-shadow: 0 18px 45px rgba(16, 40, 61, .08); text-decoration: none; transition: transform .18s ease, border-color .18s ease; }
        .choice:hover { border-color: #0b7772; transform: translateY(-3px); }
        .choice h2 { margin: 0; font-size: 1.35rem; letter-spacing: -.03em; }
        .choice p { margin: 12px 0 0; color: #536572; line-height: 1.55; }
        .choice-arrow { color: #0b7772; font-weight: 800; }
        button:focus-visible, a:focus-visible { outline: 3px solid #e47d6c; outline-offset: 3px; }
        @media (max-width: 650px) { .onboarding-page { padding: 20px; } .intro { margin-top: 64px; } .choice-grid { grid-template-columns: 1fr; } .choice { min-height: 170px; } }
        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; } }
      `}</style>
      <div className="onboarding-shell">
        <div className="toolbar" aria-label={copy.languageLabel}>
          <span>{copy.languageLabel}</span>
          {(["en", "es"] as const).map((candidate) => (
            <button
              className="locale-button"
              key={candidate}
              type="button"
              aria-pressed={locale === candidate}
              onClick={() => setLocale(candidate)}
            >
              {candidate === "en" ? copy.localeEnglish : copy.localeSpanish}
            </button>
          ))}
        </div>
        <section className="intro" aria-labelledby="onboarding-title">
          <p className="eyebrow">{copy.workspaceLabel}</p>
          <h1 id="onboarding-title">{copy.title}</h1>
          <p className="description">{copy.description}</p>
        </section>
        <section className="choice-grid" aria-label={copy.title}>
          <Link className="choice" href="/onboarding/create-business">
            <div><h2>{copy.createAction}</h2><p>{copy.createDescription}</p></div>
            <span className="choice-arrow" aria-hidden="true">&gt;</span>
          </Link>
          <Link className="choice" href="/onboarding/join-business">
            <div><h2>{copy.joinAction}</h2><p>{copy.joinDescription}</p></div>
            <span className="choice-arrow" aria-hidden="true">&gt;</span>
          </Link>
        </section>
      </div>
    </main>
  );
}
