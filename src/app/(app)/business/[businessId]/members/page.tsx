"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

import { messages } from "@/i18n/config";
import { useUrlLocale } from "@/ui/useUrlLocale";

type JoinRequest = { id: string; requesterId: string; status: string };

function messageForError(code: string | undefined, copy: typeof messages.en.onboarding): string {
  if (code === "NETWORK_ERROR") return copy.networkError;
  if (code === "INSUFFICIENT_CAPABILITY") return copy.accessError;
  if (code === "REPOSITORY_CONFLICT") return copy.conflictError;
  if (code === "INVALID_JOIN_REQUEST_TRANSITION") return copy.invalidTransition;
  if (code === "JOIN_REQUEST_NOT_FOUND") return copy.hiddenRequest;
  return copy.genericError;
}

export default function MembersPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = use(params);
  const { locale, setLocale, hrefFor } = useUrlLocale();
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const copy = messages[locale].onboarding;

  const load = async () => {
    try {
      const response = await fetch(`/api/businesses/${businessId}/join-requests`);
      const payload = await response.json() as JoinRequest[] & { error?: { code?: string } };
      if (!response.ok) { setErrorCode(payload.error?.code ?? "UNKNOWN_ERROR"); return; }
      setRequests(payload);
    } catch {
      setErrorCode("NETWORK_ERROR");
    }
  };

  useEffect(() => { void load(); }, [businessId]);

  const review = async (request: JoinRequest, decision: "approved" | "rejected") => {
    setErrorCode(null); setStatus(null);
    try {
      const response = await fetch(`/api/businesses/${businessId}/join-requests`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ joinRequestId: request.id, decision }) });
      const payload = await response.json() as JoinRequest & { error?: { code?: string } };
      if (!response.ok) { setErrorCode(payload.error?.code ?? "UNKNOWN_ERROR"); return; }
      setRequests((current) => current.filter((item) => item.id !== request.id));
      setStatus(decision === "approved" ? copy.requestApproved : copy.requestRejected);
    } catch {
      setErrorCode("NETWORK_ERROR");
    }
  };

  return (
    <main className="members-page">
      <style>{`:root { color-scheme: light; } * { box-sizing: border-box; } body { margin: 0; background: #f8f4ec; color: #10283d; font-family: Inter, ui-sans-serif, system-ui, sans-serif; } .members-page { min-height: 100vh; padding: 28px; background: radial-gradient(circle at 85% 5%, rgba(49,154,145,.16), transparent 30%), #f8f4ec; } .members-shell { width: min(100%, 760px); margin: 0 auto; } .toolbar { display: flex; justify-content: flex-end; gap: 10px; align-items: center; color: #4c6270; font-size: .82rem; } .locale-button { border: 0; border-radius: 7px; padding: 7px 9px; background: transparent; color: #4c6270; cursor: pointer; font: inherit; font-weight: 700; } .locale-button[aria-pressed="true"] { background: #d9eeea; color: #0b6663; } .back { display: inline-block; margin-top: 72px; color: #0b7772; font-weight: 750; } .members-card { margin-top: 26px; padding: clamp(24px,5vw,52px); border: 1px solid #cbd9d5; border-radius: 22px; background: #fffdf8; box-shadow: 0 18px 45px rgba(16,40,61,.08); } .eyebrow { margin: 0 0 14px; color: #0b7772; font-size: .76rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; } h1 { margin: 0; font-size: clamp(2.3rem,6vw,4.4rem); line-height: 1; letter-spacing: -.06em; } .description { margin: 20px 0 32px; color: #536572; line-height: 1.6; } .requests { display: grid; gap: 10px; } .request { display: flex; align-items: center; justify-content: space-between; gap: 15px; padding: 17px; border: 1px solid #d7e0dc; border-radius: 12px; background: #fff; } .request-id { margin: 0 0 4px; font-weight: 750; } .request-role { margin: 0; color: #536572; font-size: .82rem; } .actions { display: flex; gap: 8px; } button { min-height: 44px; border: 1px solid #0b7772; border-radius: 10px; padding: 0 13px; background: #0b7772; color: white; cursor: pointer; font: inherit; font-weight: 750; } button.secondary { border-color: #bb584b; background: #fff3ed; color: #793e35; } button:focus-visible, a:focus-visible { outline: 3px solid #e47d6c; outline-offset: 3px; } .feedback { color: #0b6663; } .error { color: #913f35; } .empty { color: #536572; }`}</style>
      <style>{`
        .request { flex-wrap: wrap; min-width: 0; }
        .request > div:first-child { min-width: 0; overflow-wrap: anywhere; }
        .actions { flex-wrap: wrap; max-width: 100%; }
        .actions button { flex: 1 1 140px; transition: transform .18s ease, background-color .18s ease; }
        @media (max-width: 650px) {
          .members-page { padding: 20px; }
          .back { margin-top: 52px; }
          .request { align-items: stretch; flex-direction: column; }
          .actions { width: 100%; }
          .actions button { width: 100%; }
        }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
        }
      `}</style>
      <div className="members-shell">
        <div className="toolbar" aria-label={copy.languageLabel}><span>{copy.languageLabel}</span>{(["en", "es"] as const).map((candidate) => <button className="locale-button" key={candidate} type="button" aria-pressed={locale === candidate} onClick={() => setLocale(candidate)}>{candidate === "en" ? copy.localeEnglish : copy.localeSpanish}</button>)}</div>
         <Link className="back" href={hrefFor(`/business/${businessId}`)}>{copy.brand} / {copy.title}</Link>
        <section className="members-card" aria-labelledby="members-title"><p className="eyebrow">{copy.ownerRole} / {copy.administratorAccess}</p><h1 id="members-title">{copy.membersTitle}</h1><p className="description">{copy.membersDescription}</p>
           {errorCode && <p className="error" role="alert">{messageForError(errorCode, copy)}</p>}{status && <p className="feedback" role="status" aria-live="polite">{status}</p>}
          <div className="requests">{requests.length === 0 ? <p className="empty">{copy.noPending}</p> : requests.map((request) => <article className="request" key={request.id}><div><p className="request-id">{copy.pendingFrom.replace("{id}", request.requesterId)}</p><p className="request-role">{copy.administratorRole}</p></div><div className="actions"><button type="button" onClick={() => review(request, "approved")}>{copy.approveButton}</button><button className="secondary" type="button" onClick={() => review(request, "rejected")}>{copy.rejectButton}</button></div></article>)}</div>
        </section>
      </div>
    </main>
  );
}
