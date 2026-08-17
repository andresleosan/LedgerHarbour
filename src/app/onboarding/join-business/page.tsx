"use client";

import Link from "next/link";
import { useState } from "react";

import { messages, type SupportedLocale } from "@/i18n/config";
import OnboardingSignOut from "@/ui/OnboardingSignOut";

type BusinessSummary = { id: string; name: string; isActive: boolean };
type RequestStatus = "pending" | "approved" | "rejected" | "unavailable";
type JoinRequestSummary = { status: RequestStatus };
type ErrorPayload = { error?: { code?: string } };

function messageForError(code: string | undefined, copy: typeof messages.en.onboarding): string {
  if (code === "INVALID_SEARCH_QUERY") return copy.invalidSearch;
  if (code === "INVALID_REQUEST_ROLE") return copy.invalidRole;
  if (code === "INACTIVE_BUSINESS") return copy.businessUnavailable;
  if (code === "MEMBERSHIP_ALREADY_EXISTS") return copy.alreadyMember;
  if (code === "PENDING_JOIN_REQUEST_EXISTS") return copy.pendingStatus;
  if (code === "REPOSITORY_CONFLICT") return copy.conflictError;
  return copy.genericError;
}

export default function JoinBusinessPage() {
  const [locale, setLocale] = useState<SupportedLocale>("en");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BusinessSummary[]>([]);
  const [requestStates, setRequestStates] = useState<Record<string, RequestStatus | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = messages[locale].onboarding;

  const search = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null); setStatus(null); setResults([]);
    if (!query.trim()) { setError(copy.invalidSearch); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/businesses/search?q=${encodeURIComponent(query)}`);
      const payload = await response.json() as BusinessSummary[] & ErrorPayload;
      if (!response.ok) { setError(messageForError(payload.error?.code, copy)); return; }
      setResults(payload);
      const statuses = await Promise.all(payload.map(async (result) => {
        try {
          const statusResponse = await fetch(`/api/businesses/${result.id}/join-requests?mine=true`);
          if (!statusResponse.ok) return [result.id, "unavailable"] as const;
          const requests = await statusResponse.json() as JoinRequestSummary[];
          return [result.id, requests.at(-1)?.status] as const;
        } catch {
          return [result.id, "unavailable"] as const;
        }
      }));
      setRequestStates(Object.fromEntries(statuses));
    } catch { setError(copy.networkError); } finally { setBusy(false); }
  };

  const request = async (businessId: string) => {
    setError(null); setStatus(null); setBusy(true);
    try {
      const response = await fetch(`/api/businesses/${businessId}/join-requests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestedRole: "administrator" }) });
      const payload = await response.json() as ErrorPayload;
      if (!response.ok) { setError(messageForError(payload.error?.code, copy)); return; }
      setRequestStates((current) => ({ ...current, [businessId]: "pending" })); setStatus(copy.requestSubmitted);
    } catch { setError(copy.networkError); } finally { setBusy(false); }
  };

  return (
    <main className="flow-page">
      <style>{`
        :root { color-scheme: light; } * { box-sizing: border-box; } body { margin: 0; background: #f8f4ec; color: #10283d; font-family: Inter, ui-sans-serif, system-ui, sans-serif; } .flow-page { min-height: 100vh; padding: 28px; background: radial-gradient(circle at 85% 5%, rgba(49,154,145,.16), transparent 30%), #f8f4ec; } .flow-shell { width: min(100%, 760px); margin: 0 auto; } .toolbar { display: flex; justify-content: flex-end; gap: 10px; align-items: center; color: #4c6270; font-size: .82rem; } .locale-button { border: 0; border-radius: 7px; padding: 7px 9px; background: transparent; color: #4c6270; cursor: pointer; font: inherit; font-weight: 700; } .locale-button[aria-pressed="true"] { background: #d9eeea; color: #0b6663; } .back { display: inline-block; margin-top: 72px; color: #0b7772; font-weight: 750; } .flow-card { margin-top: 26px; padding: clamp(24px,5vw,52px); border: 1px solid #cbd9d5; border-radius: 22px; background: #fffdf8; box-shadow: 0 18px 45px rgba(16,40,61,.08); } .eyebrow { margin: 0 0 14px; color: #0b7772; font-size: .76rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; } h1 { margin: 0; font-size: clamp(2.3rem,6vw,4.4rem); line-height: 1; letter-spacing: -.06em; } .description { margin: 20px 0 32px; color: #536572; line-height: 1.6; } form { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: end; } label { font-size: .88rem; font-weight: 750; } input { width: 100%; min-height: 52px; margin-top: 7px; padding: 0 15px; border: 1px solid #aabbb9; border-radius: 10px; color: #10283d; font: inherit; font-size: 1rem; } input:focus-visible { outline: 3px solid #e47d6c; outline-offset: 3px; } button { min-height: 50px; border: 1px solid #0b7772; border-radius: 10px; padding: 0 18px; background: #0b7772; color: white; cursor: pointer; font: inherit; font-weight: 750; } button:hover { background: #095f5b; } button:focus-visible, a:focus-visible { outline: 3px solid #e47d6c; outline-offset: 3px; } button:disabled { cursor: wait; opacity: .65; } .results { display: grid; gap: 10px; margin-top: 26px; } .result { display: flex; align-items: center; justify-content: space-between; gap: 15px; padding: 17px; border: 1px solid #d7e0dc; border-radius: 12px; background: #fff; } .result-name { margin: 0; font-weight: 750; } .result-state { margin: 4px 0 0; color: #536572; font-size: .82rem; } .feedback { margin: 18px 0 0; color: #0b6663; line-height: 1.5; } .error { margin: 14px 0 0; color: #913f35; line-height: 1.45; } .empty { color: #536572; } @media (max-width: 650px) { .flow-page { padding: 20px; } .back { margin-top: 52px; } form { grid-template-columns: 1fr; } .result { align-items: flex-start; flex-direction: column; } button { width: 100%; } } @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: .01ms !important; } }
      `}</style>
      <style>{`
        @media (max-width: 650px) {
          form { grid-template-columns: 1fr; }
          .result { align-items: stretch; flex-direction: column; }
          .result button { width: 100%; }
        }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
        }
      `}</style>
      <div className="flow-shell">
         <div className="toolbar" aria-label={copy.languageLabel}><span>{copy.languageLabel}</span>{(["en", "es"] as const).map((candidate) => <button className="locale-button" key={candidate} type="button" aria-pressed={locale === candidate} onClick={() => setLocale(candidate)}>{candidate === "en" ? copy.localeEnglish : copy.localeSpanish}</button>)}<OnboardingSignOut label={copy.signOut} /></div>
        <Link className="back" href="/onboarding">{copy.brand} / {copy.title}</Link>
        <section className="flow-card" aria-labelledby="join-business-title">
          <p className="eyebrow">{copy.administratorAccess}</p><h1 id="join-business-title">{copy.joinTitle}</h1><p className="description">{copy.joinDescription}</p>
          <form onSubmit={search} noValidate><label htmlFor="business-search">{copy.searchLabel}<input id="business-search" name="businessSearch" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} /></label><button type="submit" disabled={busy}>{busy ? copy.searching : copy.searchButton}</button></form>
          {error && <p className="error" role="alert">{error}</p>}{status && <p className="feedback" role="status" aria-live="polite">{status}</p>}
          <div className="results" aria-live="polite">{results.length === 0 && query.trim() && !busy ? <p className="empty">{copy.noResults}</p> : results.map((result) => {
            const requestState = requestStates[result.id];
            const stateLabel = requestState === "pending" ? copy.pendingStatus : requestState === "rejected" ? copy.rejectedStatus : requestState === "approved" ? copy.approvedStatus : requestState === "unavailable" ? copy.historyUnavailable : copy.activeBusiness;
            const actionLabel = requestState === "rejected" ? copy.reapplyButton : requestState === "pending" ? copy.pendingStatus : requestState === "approved" ? copy.alreadyMember : requestState === "unavailable" ? copy.historyUnavailable : copy.requestButton;
            return <article className="result" key={result.id}><div><p className="result-name">{result.name}</p><p className="result-state">{stateLabel}</p></div><button type="button" disabled={busy || requestState === "pending" || requestState === "approved" || requestState === "unavailable"} onClick={() => request(result.id)}>{actionLabel}</button></article>;
          })}</div>
        </section>
      </div>
    </main>
  );
}
