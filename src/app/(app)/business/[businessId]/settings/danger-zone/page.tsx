"use client";

import Link from "next/link";
import { use, useState } from "react";

import { messages } from "@/i18n/config";
import { useUrlLocale } from "@/ui/useUrlLocale";

export default function DangerZonePage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = use(params);
  const { locale, setLocale, hrefFor } = useUrlLocale();
  const [confirmationName, setConfirmationName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [inactive, setInactive] = useState(false);
  const [busy, setBusy] = useState(false);
  const copy = messages[locale].onboarding;

  const changeLifecycle = async (action: "deactivate" | "reactivate") => {
    setBusy(true); setError(null); setStatus(null);
    try {
       const response = await fetch(`/api/businesses/${businessId}/lifecycle`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, confirmationName }) });
      const payload = await response.json() as { error?: { code?: string } };
       if (!response.ok) { setError(payload.error?.code === "INSUFFICIENT_CAPABILITY" ? copy.settingsAccessError : payload.error?.code === "CONFIRMATION_REQUIRED" ? copy.confirmationError : copy.lifecycleError); return; }
      setInactive(action === "deactivate");
      setStatus(action === "deactivate" ? copy.businessDeactivated : copy.businessReactivated);
      setConfirmationName("");
    } catch { setError(copy.lifecycleError); } finally { setBusy(false); }
  };

  return (
    <main className="danger-page">
      <style>{`
        :root { color-scheme: light; } * { box-sizing: border-box; } body { margin: 0; background: #f8f4ec; color: #10283d; font-family: Inter, ui-sans-serif, system-ui, sans-serif; } .danger-page { min-height: 100vh; padding: 28px; background: radial-gradient(circle at 85% 5%, rgba(190,91,74,.14), transparent 30%), #f8f4ec; } .danger-shell { width: min(100%, 720px); margin: 0 auto; } .toolbar { display: flex; justify-content: flex-end; gap: 10px; align-items: center; color: #4c6270; font-size: .82rem; } .locale { border: 0; border-radius: 7px; padding: 7px 9px; background: transparent; color: #4c6270; cursor: pointer; font: inherit; font-weight: 700; } .locale[aria-pressed="true"] { background: #f4dbd2; color: #793e35; } .back { display: inline-block; margin-top: 62px; color: #0b7772; font-weight: 750; } .card { margin-top: 25px; padding: clamp(24px, 5vw, 50px); border: 1px solid #e1b9a8; border-radius: 22px; background: #fffdf8; box-shadow: 0 18px 45px rgba(16,40,61,.08); } .eyebrow { margin: 0 0 14px; color: #913f35; font-size: .76rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; } h1 { margin: 0; font-size: clamp(2.3rem, 6vw, 4.4rem); line-height: 1; letter-spacing: -.06em; } .description { color: #536572; line-height: 1.6; } .warning { padding: 16px; border-left: 4px solid #bb584b; background: #fff1eb; color: #6e382f; line-height: 1.55; } label { display: block; margin-top: 22px; font-weight: 750; } input { width: 100%; min-height: 50px; margin-top: 7px; padding: 0 14px; border: 1px solid #aabbb9; border-radius: 10px; color: #10283d; font: inherit; } .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; } button { min-height: 48px; border: 1px solid #bb584b; border-radius: 10px; padding: 0 15px; background: #bb584b; color: white; cursor: pointer; font: inherit; font-weight: 750; } button.secondary { background: white; color: #793e35; } button:disabled { cursor: wait; opacity: .55; } button:focus-visible, a:focus-visible, input:focus-visible { outline: 3px solid #e47d6c; outline-offset: 3px; } .feedback { color: #0b6663; } .error { color: #913f35; } @media (max-width: 650px) { .danger-page { padding: 20px; } .back { margin-top: 48px; } .actions button { width: 100%; } } @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: .01ms !important; animation-duration: .01ms !important; } }
      `}</style>
      <div className="danger-shell"><div className="toolbar" aria-label={copy.languageLabel}><span>{copy.languageLabel}</span>{(["en", "es"] as const).map((candidate) => <button className="locale" key={candidate} type="button" aria-pressed={locale === candidate} onClick={() => setLocale(candidate)}>{candidate === "en" ? copy.localeEnglish : copy.localeSpanish}</button>)}</div>
         <Link className="back" href={hrefFor(`/business/${businessId}/settings/members`)}>{copy.brand} / {copy.dangerTitle}</Link>
        <section className="card" aria-labelledby="danger-title"><p className="eyebrow">{copy.dangerEyebrow}</p><h1 id="danger-title">{copy.dangerTitle}</h1><p className="description">{copy.dangerDescription}</p><p className="warning">{copy.dangerWarning}</p>
          {error && <p className="error" role="alert">{error}</p>}{status && <p className="feedback" role="status" aria-live="polite">{status}</p>}
          <label htmlFor="business-name-confirmation">{copy.businessNameConfirmation}<input id="business-name-confirmation" value={confirmationName} onChange={(event) => setConfirmationName(event.target.value)} /></label>
          <div className="actions">{!inactive && <button type="button" disabled={busy || !confirmationName} onClick={() => void changeLifecycle("deactivate")}>{copy.deactivateBusiness}</button>}{inactive && <button type="button" disabled={busy || !confirmationName} onClick={() => void changeLifecycle("reactivate")}>{copy.reactivateBusiness}</button>}</div>
        </section>
      </div>
    </main>
  );
}
