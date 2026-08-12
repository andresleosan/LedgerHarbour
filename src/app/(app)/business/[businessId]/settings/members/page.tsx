"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

import { messages } from "@/i18n/config";
import { useUrlLocale } from "@/ui/useUrlLocale";

type Member = { membershipId: string; userId: string; businessId: string; role: "owner_admin" | "general_admin" | "administrator"; isActive: boolean; capabilities: string[] };
type ErrorPayload = { error?: { code?: string } };

export default function MembershipSettingsPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = use(params);
  const { locale, setLocale, hrefFor } = useUrlLocale();
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
      if (!response.ok) {
        setError(payload.error?.code === "INSUFFICIENT_CAPABILITY" ? copy.settingsAccessError : copy.settingsGenericError);
        return;
      }
      setMembers(payload);
    } catch {
      setError(copy.settingsGenericError);
    }
  };

  useEffect(() => { void load(); }, [businessId]);

  const mutate = async (member: Member, action: "set_general_admin" | "remove_general_admin" | "remove_administrator") => {
    setBusy(true); setError(null); setStatus(null);
    try {
      const response = await fetch(`/api/businesses/${businessId}/members/${encodeURIComponent(member.membershipId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
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
      const response = await fetch(`/api/businesses/${businessId}/ownership/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetMembershipId: selectedTarget, confirmationName, reauthenticatedAt: new Date().toISOString() }),
      });
      const payload = await response.json() as ErrorPayload;
      if (!response.ok) {
        setError(payload.error?.code === "CONFIRMATION_REQUIRED" ? copy.confirmationError : copy.settingsGenericError);
        return;
      }
      setStatus(copy.ownershipTransferred);
      setSelectedTarget(null);
      setConfirmationName("");
      await load();
    } catch { setError(copy.settingsGenericError); } finally { setBusy(false); }
  };

  return (
    <main className="settings-page">
      <style>{`
        :root { color-scheme: light; } * { box-sizing: border-box; } body { margin: 0; background: #f8f4ec; color: #10283d; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
        .settings-page { min-height: 100vh; padding: 28px; background: radial-gradient(circle at 85% 5%, rgba(49,154,145,.16), transparent 30%), #f8f4ec; }
        .settings-shell { width: min(100%, 820px); margin: 0 auto; } .toolbar { display: flex; justify-content: flex-end; gap: 10px; align-items: center; color: #4c6270; font-size: .82rem; } .locale { border: 0; border-radius: 7px; padding: 7px 9px; background: transparent; color: #4c6270; cursor: pointer; font: inherit; font-weight: 700; } .locale[aria-pressed="true"] { background: #d9eeea; color: #0b6663; }
        .back { display: inline-block; margin-top: 62px; color: #0b7772; font-weight: 750; } .card { margin-top: 25px; padding: clamp(24px, 5vw, 50px); border: 1px solid #cbd9d5; border-radius: 22px; background: #fffdf8; box-shadow: 0 18px 45px rgba(16,40,61,.08); } .eyebrow { margin: 0 0 14px; color: #0b7772; font-size: .76rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; } h1 { margin: 0; font-size: clamp(2.3rem, 6vw, 4.4rem); line-height: 1; letter-spacing: -.06em; } .description { color: #536572; line-height: 1.6; }
        .members { display: grid; gap: 12px; margin-top: 28px; } .member { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 17px; border: 1px solid #d7e0dc; border-radius: 12px; background: white; } .member-info { min-width: 0; } .member-id { margin: 0 0 5px; font-weight: 750; overflow-wrap: anywhere; } .member-role { margin: 0; color: #536572; } .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; } button { min-height: 44px; border: 1px solid #0b7772; border-radius: 10px; padding: 0 13px; background: #0b7772; color: white; cursor: pointer; font: inherit; font-weight: 750; } button.secondary { border-color: #bb584b; background: #fff3ed; color: #793e35; } button.tertiary { border-color: #6d8790; background: white; color: #264c5a; } button:disabled { cursor: wait; opacity: .55; } button:focus-visible, a:focus-visible, input:focus-visible { outline: 3px solid #e47d6c; outline-offset: 3px; } input { width: 100%; min-height: 48px; margin-top: 7px; padding: 0 13px; border: 1px solid #aabbb9; border-radius: 10px; color: #10283d; font: inherit; }
        .transfer { margin-top: 24px; padding: 20px; border: 1px solid #e1b9a8; border-radius: 14px; background: #fff6ef; } .transfer h2 { margin-top: 0; font-size: 1.15rem; } .transfer label { display: block; font-weight: 700; } .transfer p { color: #536572; line-height: 1.5; } .feedback { color: #0b6663; } .error { color: #913f35; } @media (max-width: 650px) { .settings-page { padding: 20px; } .back { margin-top: 48px; } .member { align-items: stretch; flex-direction: column; } .actions { justify-content: stretch; } .actions button { flex: 1 1 100%; } }
        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; } }
      `}</style>
      <div className="settings-shell">
        <div className="toolbar" aria-label={copy.languageLabel}><span>{copy.languageLabel}</span>{(["en", "es"] as const).map((candidate) => <button className="locale" key={candidate} type="button" aria-pressed={locale === candidate} onClick={() => setLocale(candidate)}>{candidate === "en" ? copy.localeEnglish : copy.localeSpanish}</button>)}</div>
         <Link className="back" href={hrefFor(`/business/${businessId}/members`)}>{copy.brand} / {copy.settingsMembersTitle}</Link>
        <section className="card" aria-labelledby="settings-members-title"><p className="eyebrow">{copy.settingsEyebrow}</p><h1 id="settings-members-title">{copy.settingsMembersTitle}</h1><p className="description">{copy.settingsMembersDescription}</p>
          {error && <p className="error" role="alert">{error}</p>}{status && <p className="feedback" role="status" aria-live="polite">{status}</p>}
          <div className="members">{members.map((member) => <article className="member" key={member.userId}><div className="member-info"><p className="member-id">{member.userId}</p><p className="member-role">{member.role === "owner_admin" ? copy.ownerRole : member.role === "general_admin" ? copy.generalAdminRole : copy.administratorRole}</p></div><div className="actions">
             {member.capabilities.includes("set_general_admin") && <button type="button" disabled={busy} onClick={() => void mutate(member, "set_general_admin")}>{copy.makeGeneralAdmin}</button>}
             {member.capabilities.includes("remove_general_admin") && <button className="secondary" type="button" disabled={busy} onClick={() => void mutate(member, "remove_general_admin")}>{copy.removeGeneralAdmin}</button>}
              {member.capabilities.includes("transfer_ownership") && <button className="tertiary" type="button" disabled={busy} onClick={() => setSelectedTarget(member.membershipId)}>{copy.transferOwnership}</button>}
             {member.capabilities.includes("remove_administrator") && <button className="secondary" type="button" disabled={busy} onClick={() => void mutate(member, "remove_administrator")}>{copy.removeAdministrator}</button>}
          </div></article>)}</div>
          {selectedTarget && <div className="transfer" aria-labelledby="transfer-title"><h2 id="transfer-title">{copy.transferTitle}</h2><p>{copy.transferDescription}</p><label htmlFor="transfer-confirmation">{copy.businessNameConfirmation}<input id="transfer-confirmation" value={confirmationName} onChange={(event) => setConfirmationName(event.target.value)} /></label><div className="actions"><button type="button" disabled={busy || !confirmationName} onClick={() => void transfer()}>{copy.confirmTransfer}</button><button className="tertiary" type="button" disabled={busy} onClick={() => setSelectedTarget(null)}>{copy.cancel}</button></div></div>}
        </section>
      </div>
    </main>
  );
}
