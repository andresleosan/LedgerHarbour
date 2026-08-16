"use client";

import Link from "next/link";
import { use, useState } from "react";

import { messages } from "@/i18n/config";
import { useUrlLocale } from "@/ui/useUrlLocale";

export default function DangerZonePage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = use(params);
  const { locale, hrefFor } = useUrlLocale();
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
      setInactive(action === "deactivate"); setStatus(action === "deactivate" ? copy.businessDeactivated : copy.businessReactivated); setConfirmationName("");
    } catch { setError(copy.lifecycleError); } finally { setBusy(false); }
  };

  return (
    <main className="operational-page danger-page">
      <div className="page-shell danger-shell">
        <Link className="page-back" href={hrefFor(`/business/${businessId}/settings/members`)}>{copy.brand} / {copy.dangerTitle}</Link>
        <section className="page-card danger-card" aria-labelledby="danger-title"><p className="page-eyebrow danger-eyebrow">{copy.dangerEyebrow}</p><h1 className="page-title" id="danger-title">{copy.dangerTitle}</h1><p className="page-description">{copy.dangerDescription}</p><p className="danger-warning">{copy.dangerWarning}</p>
          {error && <p className="page-error" role="alert">{error}</p>}{status && <p className="page-feedback" role="status" aria-live="polite">{status}</p>}
          <label className="danger-label" htmlFor="business-name-confirmation">{copy.businessNameConfirmation}<input className="page-input" id="business-name-confirmation" value={confirmationName} onChange={(event) => setConfirmationName(event.target.value)} /></label>
          <div className="page-actions">{!inactive && <button className="secondary-button danger-action" type="button" disabled={busy || !confirmationName} onClick={() => void changeLifecycle("deactivate")}>{copy.deactivateBusiness}</button>}{inactive && <button className="primary-button" type="button" disabled={busy || !confirmationName} onClick={() => void changeLifecycle("reactivate")}>{copy.reactivateBusiness}</button>}</div>
        </section>
      </div>
    </main>
  );
}
