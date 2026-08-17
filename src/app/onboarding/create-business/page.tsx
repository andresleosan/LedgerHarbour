"use client";

import Link from "next/link";
import { useState } from "react";

import { messages, type SupportedLocale } from "@/i18n/config";
import OnboardingSignOut from "@/ui/OnboardingSignOut";

type BusinessResponse = { id: string; name: string; status: "pending" | "active" | "suspended" | "rejected" };
type ErrorPayload = { error?: { code?: string } };

function messageForError(code: string | undefined, copy: typeof messages.en.onboarding): string {
  if (code === "INVALID_BUSINESS_NAME") return copy.invalidName;
  if (code === "REPOSITORY_CONFLICT") return copy.conflictError;
  return copy.genericError;
}

export default function CreateBusinessPage() {
  const [locale, setLocale] = useState<SupportedLocale>("en");
  const [name, setName] = useState("");
  const [result, setResult] = useState<BusinessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = messages[locale].onboarding;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    if (!name.trim()) {
      setError(copy.invalidName);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/businesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = await response.json() as BusinessResponse & ErrorPayload;
      if (!response.ok) {
        setError(messageForError(payload.error?.code, copy));
        return;
      }
      setResult(payload);
      setName("");
    } catch {
      setError(copy.genericError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flow-page">
      <style>{`
        :root { color-scheme: light; } * { box-sizing: border-box; } body { margin: 0; background: #f8f4ec; color: #10283d; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
        .flow-page { min-height: 100vh; padding: 28px; background: radial-gradient(circle at 85% 5%, rgba(49,154,145,.16), transparent 30%), #f8f4ec; }
         .flow-shell { width: min(100%, 680px); margin: 0 auto; } .toolbar { display: flex; justify-content: flex-end; gap: 10px; align-items: center; color: #4c6270; font-size: .82rem; } .locale-button { border: 0; border-radius: 7px; padding: 7px 9px; background: transparent; color: #4c6270; cursor: pointer; font: inherit; font-weight: 700; } .locale-button[aria-pressed="true"] { background: #d9eeea; color: #0b6663; } .sign-out { border: 1px solid #9bb7b0; border-radius: 8px; padding: 7px 10px; background: #fffdf8; color: #315b60; cursor: pointer; font: inherit; font-weight: 750; }
        .back { display: inline-block; margin-top: 72px; color: #0b7772; font-weight: 750; } .flow-card { margin-top: 26px; padding: clamp(24px, 5vw, 52px); border: 1px solid #cbd9d5; border-radius: 22px; background: #fffdf8; box-shadow: 0 18px 45px rgba(16,40,61,.08); } .eyebrow { margin: 0 0 14px; color: #0b7772; font-size: .76rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; } h1 { margin: 0; font-size: clamp(2.3rem, 6vw, 4.4rem); line-height: 1; letter-spacing: -.06em; } .description { margin: 20px 0 32px; color: #536572; line-height: 1.6; } form { display: grid; gap: 12px; } label { font-size: .88rem; font-weight: 750; } input { width: 100%; min-height: 52px; margin-top: 7px; padding: 0 15px; border: 1px solid #aabbb9; border-radius: 10px; color: #10283d; font: inherit; font-size: 1rem; } input:focus-visible { outline: 3px solid #e47d6c; outline-offset: 3px; } button { min-height: 50px; border: 1px solid #0b7772; border-radius: 10px; background: #0b7772; color: white; cursor: pointer; font: inherit; font-weight: 750; } button:hover { background: #095f5b; } button:focus-visible, a:focus-visible { outline: 3px solid #e47d6c; outline-offset: 3px; } button:disabled { cursor: wait; opacity: .65; } .feedback { margin: 18px 0 0; color: #0b6663; line-height: 1.5; } .error { margin: 14px 0 0; color: #913f35; line-height: 1.45; } @media (max-width: 650px) { .flow-page { padding: 20px; } .back { margin-top: 52px; } } @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: .01ms !important; } }
      `}</style>
      <div className="flow-shell">
         <div className="toolbar" aria-label={copy.languageLabel}><span>{copy.languageLabel}</span>{(["en", "es"] as const).map((candidate) => <button className="locale-button" key={candidate} type="button" aria-pressed={locale === candidate} onClick={() => setLocale(candidate)}>{candidate === "en" ? copy.localeEnglish : copy.localeSpanish}</button>)}<OnboardingSignOut label={copy.signOut} /></div>
        <Link className="back" href="/onboarding">{copy.brand} / {copy.title}</Link>
        <section className="flow-card" aria-labelledby="create-business-title">
          <p className="eyebrow">{copy.ownerRole}</p>
          <h1 id="create-business-title">{copy.createTitle}</h1>
          <p className="description">{copy.createDescription}</p>
          <form onSubmit={submit} noValidate>
            <label htmlFor="business-name">{copy.businessNameLabel}<input id="business-name" name="businessName" value={name} onChange={(event) => setName(event.target.value)} placeholder={copy.businessNamePlaceholder} aria-invalid={Boolean(error)} /></label>
            <button type="submit" disabled={busy}>{busy ? copy.creating : copy.createButton}</button>
          </form>
          {error && <p className="error" role="alert">{error}</p>}
          {result && <p className="feedback" role="status" aria-live="polite">{copy.created.replace("{name}", result.name).replace("{id}", result.id)}</p>}
        </section>
      </div>
    </main>
  );
}
