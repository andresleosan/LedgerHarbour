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
  const { locale, hrefFor } = useUrlLocale();
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
    <main className="operational-page members-page">
      <div className="page-shell members-shell">
        <Link className="page-back" href={hrefFor(`/business/${businessId}`)}>{copy.brand} / {copy.title}</Link>
        <section className="page-card" aria-labelledby="members-title"><p className="page-eyebrow">{copy.ownerRole} / {copy.administratorAccess}</p><h1 className="page-title" id="members-title">{copy.membersTitle}</h1><p className="page-description">{copy.membersDescription}</p>
          {errorCode && <p className="page-error" role="alert">{messageForError(errorCode, copy)}</p>}{status && <p className="page-feedback" role="status" aria-live="polite">{status}</p>}
          <div className="request-list">{requests.length === 0 ? <p className="page-empty">{copy.noPending}</p> : requests.map((request) => <article className="request-row" key={request.id}><div><p className="request-id">{copy.pendingFrom.replace("{id}", request.requesterId)}</p><p className="request-role">{copy.administratorRole}</p></div><div className="page-actions"><button className="primary-button" type="button" onClick={() => void review(request, "approved")}>{copy.approveButton}</button><button className="secondary-button" type="button" onClick={() => void review(request, "rejected")}>{copy.rejectButton}</button></div></article>)}</div>
        </section>
      </div>
    </main>
  );
}
