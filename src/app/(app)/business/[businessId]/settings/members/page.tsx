"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

import { messages } from "@/i18n/config";
import { useUrlLocale } from "@/ui/useUrlLocale";

type Member = { membershipId: string; userId: string; businessId: string; role: "owner_admin" | "general_admin" | "administrator"; isActive: boolean; capabilities: string[] };
type ErrorPayload = { error?: { code?: string } };

export default function MembershipSettingsPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = use(params);
  const { locale, hrefFor } = useUrlLocale();
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [confirmationName, setConfirmationName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = messages[locale].onboarding;

  const load = async () => {
    try {
      const response = await fetch(`/api/businesses/${businessId}/members/list`);
      const payload = await response.json() as Member[] & ErrorPayload;
      if (!response.ok) { setError(payload.error?.code === "INSUFFICIENT_CAPABILITY" ? copy.settingsAccessError : copy.settingsGenericError); return; }
      setMembers(payload);
    } catch {
      setError(copy.settingsGenericError);
    }
  };

  useEffect(() => { void load(); }, [businessId]);

  const mutate = async (member: Member, action: "set_general_admin" | "remove_general_admin" | "remove_administrator") => {
    setBusy(true); setError(null); setStatus(null);
    try {
      const response = await fetch(`/api/businesses/${businessId}/members/${encodeURIComponent(member.membershipId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const payload = await response.json() as Member & ErrorPayload;
      if (!response.ok) { setError(payload.error?.code === "INSUFFICIENT_CAPABILITY" ? copy.settingsAccessError : copy.settingsGenericError); return; }
      setStatus(action === "set_general_admin" ? copy.generalAdminAssigned : copy.memberRemoved);
      await load();
    } catch { setError(copy.settingsGenericError); } finally { setBusy(false); }
  };

  const transfer = async () => {
    if (!selectedTarget) return;
    setBusy(true); setError(null); setStatus(null);
    try {
      const response = await fetch(`/api/businesses/${businessId}/ownership/transfer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetMembershipId: selectedTarget, confirmationName, reauthenticatedAt: new Date().toISOString() }) });
      const payload = await response.json() as ErrorPayload;
      if (!response.ok) { setError(payload.error?.code === "CONFIRMATION_REQUIRED" ? copy.confirmationError : copy.settingsGenericError); return; }
      setStatus(copy.ownershipTransferred); setSelectedTarget(null); setConfirmationName(""); await load();
    } catch { setError(copy.settingsGenericError); } finally { setBusy(false); }
  };

  return (
    <main className="operational-page settings-page">
      <div className="page-shell settings-members-shell">
        <Link className="page-back" href={hrefFor(`/business/${businessId}/members`)}>{copy.brand} / {copy.settingsMembersTitle}</Link>
        <section className="page-card" aria-labelledby="settings-members-title"><p className="page-eyebrow">{copy.settingsEyebrow}</p><h1 className="page-title" id="settings-members-title">{copy.settingsMembersTitle}</h1><p className="page-description">{copy.settingsMembersDescription}</p>
          {error && <p className="page-error" role="alert">{error}</p>}{status && <p className="page-feedback" role="status" aria-live="polite">{status}</p>}
          <div className="settings-members-list">{members.map((member) => <article className="settings-item" key={member.userId}><div className="member-info"><p className="member-id">{member.userId}</p><p className="member-role">{member.role === "owner_admin" ? copy.ownerRole : member.role === "general_admin" ? copy.generalAdminRole : copy.administratorRole}</p></div><div className="page-actions">
            {member.capabilities.includes("set_general_admin") && <button className="primary-button" type="button" disabled={busy} onClick={() => void mutate(member, "set_general_admin")}>{copy.makeGeneralAdmin}</button>}
            {member.capabilities.includes("remove_general_admin") && <button className="secondary-button" type="button" disabled={busy} onClick={() => void mutate(member, "remove_general_admin")}>{copy.removeGeneralAdmin}</button>}
            {member.capabilities.includes("transfer_ownership") && <button className="tertiary-button" type="button" disabled={busy} onClick={() => setSelectedTarget(member.membershipId)}>{copy.transferOwnership}</button>}
            {member.capabilities.includes("remove_administrator") && <button className="secondary-button" type="button" disabled={busy} onClick={() => void mutate(member, "remove_administrator")}>{copy.removeAdministrator}</button>}
          </div></article>)}</div>
          {selectedTarget && <div className="transfer-panel" aria-labelledby="transfer-title"><h2 id="transfer-title">{copy.transferTitle}</h2><p>{copy.transferDescription}</p><label htmlFor="transfer-confirmation">{copy.businessNameConfirmation}<input className="page-input" id="transfer-confirmation" value={confirmationName} onChange={(event) => setConfirmationName(event.target.value)} /></label><div className="page-actions"><button className="primary-button" type="button" disabled={busy || !confirmationName} onClick={() => void transfer()}>{copy.confirmTransfer}</button><button className="tertiary-button" type="button" disabled={busy} onClick={() => setSelectedTarget(null)}>{copy.cancel}</button></div></div>}
        </section>
      </div>
    </main>
  );
}
