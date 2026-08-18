"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { messages, type SupportedLocale } from "@/i18n/config";
import type { PlatformAdministratorDto, PlatformBusinessDto } from "@/modules/platform/platform-service";
import type { PlatformSummaryDto } from "@/modules/platform/platform-summary";
import type { ProjectDto } from "@/modules/projects/types";
import ActionDialog, { type ActionDialogValues } from "@/ui/platform/ActionDialog";
import StatusBadge from "@/ui/platform/StatusBadge";

type Section = "all" | "businesses" | "projects" | "administrators";
type Action = "approve" | "reject" | "suspend" | "reactivate" | "revoke";

interface DialogState {
  kind: "business" | "project" | "administrator";
  id: string;
  name: string;
  action: Action;
  requiresReason: boolean;
  requiresExpiration: boolean;
}

interface PlatformAdminPanelProps {
  summary: PlatformSummaryDto;
  locale: SupportedLocale;
  section?: Section;
}

const dateFor = (value: string | null, locale: SupportedLocale) => value
  ? new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-GB", { dateStyle: "medium" }).format(new Date(value))
  : "—";

export default function PlatformAdminPanel({ summary, locale, section = "all" }: PlatformAdminPanelProps) {
  const router = useRouter();
  const copy = messages[locale].platform;
  const [status, setStatus] = useState("all");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusLabel = (value: string) => copy[value as keyof typeof copy] ?? value;
  const matchesStatus = (value: string) => status === "all" || status === value;
  const actionLabel = (action: Action) => copy[action];

  const openAction = (kind: DialogState["kind"], id: string, name: string, action: Action) => {
    setFeedback(null);
    setError(null);
    setDialog({
      kind,
      id,
      name,
      action,
      requiresReason: true,
      requiresExpiration: kind === "business" && action === "approve",
    });
  };

  const submitAction = async (values: ActionDialogValues) => {
    if (!dialog) return;
    setBusy(true);
    setError(null);
    try {
      const basePath = dialog.kind === "business"
        ? `/api/platform/businesses/${dialog.id}`
        : dialog.kind === "project"
          ? `/api/platform/projects/${dialog.id}`
          : `/api/platform/administrators/${dialog.id}`;
      const endpointAction = dialog.kind === "administrator" && (dialog.action === "revoke" || dialog.action === "suspend")
        ? "suspend"
        : dialog.action;
      const body = dialog.kind === "administrator"
        ? dialog.action === "approve" ? { reason: values.reason } : { action: dialog.action, reason: values.reason }
        : dialog.action === "approve" && dialog.kind === "business"
          ? { serviceExpiresAt: values.serviceExpiresAt ? new Date(`${values.serviceExpiresAt}T23:59:59.000Z`).toISOString() : undefined, reason: values.reason }
          : { reason: values.reason };
      const response = await fetch(`${basePath}/${endpointAction}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(payload?.error?.message ?? copy.actionError);
      setDialog(null);
      setFeedback(copy.saved);
      router.refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : copy.actionError);
    } finally {
      setBusy(false);
    }
  };

  const actionsForBusiness = (business: PlatformBusinessDto): Action[] => {
    if (business.status === "pending") return ["approve", "reject"];
    if (business.status === "active") return ["suspend"];
    if (business.status === "suspended") return ["reactivate"];
    return [];
  };

  const actionsForProject = (project: ProjectDto): Action[] => {
    if (project.status === "pending") return ["approve", "reject"];
    if (project.status === "active") return ["suspend"];
    if (project.status === "suspended") return ["reactivate"];
    return [];
  };

  const actionsForAdministrator = (administrator: PlatformAdministratorDto): Action[] => {
    if (administrator.status === "pending") return ["approve"];
    if (administrator.status === "active") return ["suspend", "revoke"];
    return [];
  };

  const actionButtons = (kind: DialogState["kind"], id: string, name: string, actions: Action[]) => (
    <div className="platform-row-actions">
      {actions.length === 0 ? <span className="platform-no-actions">{copy.noActions}</span> : actions.map((action) => (
        <button
          className={`platform-button ${action === "reject" || action === "suspend" || action === "revoke" ? "platform-button-danger" : "platform-button-primary"}`}
          key={action}
          type="button"
          onClick={() => openAction(kind, id, name, action)}
          disabled={busy}
          aria-label={`${actionLabel(action)} ${name}`}
        >
          {actionLabel(action)}
        </button>
      ))}
    </div>
  );

  const sectionHeader = (id: string, title: string, description: string, count: number) => (
    <header className="platform-section-header">
      <div><h2 id={id}>{title}</h2><p>{description}</p></div>
      <span className="platform-section-count">{count}</span>
    </header>
  );

  const businessRows = summary.businesses.filter((business) => matchesStatus(business.status));
  const projectRows = summary.projects.filter((project) => matchesStatus(project.status));
  const administratorRows = summary.administrators.filter((administrator) => matchesStatus(administrator.status));

  return (
    <div className="platform-panel">
      <style>{`
        .platform-panel { max-width: 1180px; margin: 0 auto; }
        .platform-overview { display: flex; justify-content: space-between; align-items: end; gap: 20px; margin-bottom: 26px; }
        .platform-eyebrow { margin: 0 0 9px; color: #0b7772; font-size: .74rem; font-weight: 850; letter-spacing: .14em; text-transform: uppercase; }
        .platform-title { margin: 0; color: #17313b; font-size: clamp(2rem, 5vw, 4rem); line-height: 1.02; letter-spacing: -.055em; overflow-wrap: anywhere; }
        .platform-description { max-width: 700px; margin: 15px 0 0; color: #49636b; line-height: 1.6; }
        .platform-filter { display: grid; gap: 6px; min-width: 180px; color: #49636b; font-size: .78rem; font-weight: 800; }
        .platform-filter select { min-height: 42px; border: 1px solid #9fbab1; border-radius: 9px; padding: 0 10px; background: #fff; color: #17313b; font: inherit; }
        .platform-summary-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 28px; }
        .platform-summary-card { padding: 18px; border: 1px solid #cbd9d5; border-radius: 14px; background: #fff; box-shadow: 0 12px 30px rgba(23,49,59,.05); }
        .platform-summary-card strong { display: block; color: #17313b; font-size: 2rem; letter-spacing: -.05em; }
        .platform-summary-card span { color: #49636b; font-size: .78rem; font-weight: 800; }
        .platform-section { margin-top: 20px; padding: 22px; border: 1px solid #cbd9d5; border-radius: 16px; background: rgba(255,255,255,.82); box-shadow: 0 14px 34px rgba(23,49,59,.05); }
        .platform-section-header { display: flex; justify-content: space-between; align-items: start; gap: 16px; margin-bottom: 18px; }
        .platform-section-header h2 { margin: 0; color: #17313b; font-size: 1.35rem; letter-spacing: -.03em; }
        .platform-section-header p { margin: 7px 0 0; color: #49636b; line-height: 1.5; }
        .platform-section-count { display: grid; min-width: 38px; height: 38px; place-items: center; border-radius: 12px; background: #d9eeea; color: #075b57; font-weight: 850; }
        .platform-table-wrap { width: 100%; }
        .platform-table { width: 100%; border-collapse: collapse; }
        .platform-table th { padding: 10px 9px; border-bottom: 1px solid #9fbab1; color: #55716f; font-size: .7rem; letter-spacing: .08em; text-align: left; text-transform: uppercase; }
        .platform-table td { padding: 14px 9px; border-bottom: 1px solid #e0e9e5; color: #31515a; vertical-align: top; }
        .platform-table tbody tr:last-child td { border-bottom: 0; }
        .platform-table td strong { display: block; color: #17313b; overflow-wrap: anywhere; }
        .platform-table td small { display: block; margin-top: 4px; color: #55716f; overflow-wrap: anywhere; }
        .platform-row-actions { display: flex; flex-wrap: wrap; gap: 6px; min-width: 130px; }
        .platform-row-actions .platform-button { min-height: 36px; padding: 0 9px; font-size: .76rem; }
        .platform-no-actions { color: #738783; font-size: .78rem; }
        .platform-table .platform-button:disabled { cursor: wait; opacity: .56; }
        .platform-empty { margin: 12px 0 0; color: #49636b; }
        .platform-feedback { margin: 0 0 14px; color: #075b57; font-weight: 800; }
        .platform-error { margin: 0 0 14px; color: #913f35; font-weight: 800; }
        @media (max-width: 850px) { .platform-overview { align-items: stretch; flex-direction: column; } .platform-filter { width: min(100%, 260px); } .platform-summary-cards { grid-template-columns: 1fr 1fr; } }
        @media (max-width: 650px) { .platform-summary-cards { grid-template-columns: 1fr; } .platform-section { padding: 18px 14px; } .platform-table, .platform-table thead, .platform-table tbody, .platform-table tr, .platform-table td { display: block; } .platform-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); } .platform-table tr { margin-bottom: 12px; padding: 12px; border: 1px solid #d7e3de; border-radius: 12px; background: #fff; } .platform-table tr:last-child { margin-bottom: 0; } .platform-table td { display: grid; grid-template-columns: minmax(90px, 34%) minmax(0, 1fr); gap: 9px; padding: 7px 0; border: 0; overflow-wrap: anywhere; } .platform-table td::before { content: attr(data-label); color: #55716f; font-size: .7rem; font-weight: 850; letter-spacing: .05em; text-transform: uppercase; } .platform-table td[colspan] { display: block; } .platform-table td[colspan]::before { display: none; } .platform-row-actions { justify-content: flex-start; } }
      `}</style>
      <div className="platform-overview">
        <div>
          <p className="platform-eyebrow">{copy.eyebrow}</p>
          <h1 className="platform-title">{copy.title}</h1>
          <p className="platform-description">{copy.description}</p>
        </div>
        <label className="platform-filter">
          {copy.statusFilter}
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">{copy.allStatuses}</option>
            <option value="pending">{copy.pending}</option>
            <option value="active">{copy.active}</option>
            <option value="suspended">{copy.suspended}</option>
            <option value="rejected">{copy.rejected}</option>
            <option value="revoked">{copy.revoked}</option>
          </select>
        </label>
      </div>
      <div className="platform-summary-cards" aria-label={copy.pendingQueue}>
        <article className="platform-summary-card"><strong>{summary.counts.businesses}</strong><span>{copy.businesses} · {summary.counts.pendingBusinesses} {copy.pending.toLowerCase()}</span></article>
        <article className="platform-summary-card"><strong>{summary.counts.projects}</strong><span>{copy.projects} · {summary.counts.pendingProjects} {copy.pending.toLowerCase()}</span></article>
        <article className="platform-summary-card"><strong>{summary.counts.administrators}</strong><span>{copy.administrators} · {summary.counts.pendingAdministrators} {copy.pending.toLowerCase()}</span></article>
      </div>
      {feedback && <p className="platform-feedback" role="status">{feedback}</p>}
      {error && <p className="platform-error" role="alert">{error}</p>}

      {(section === "all" || section === "businesses") && (
        <section className="platform-section" aria-labelledby="platform-businesses-title">
          {sectionHeader("platform-businesses-title", copy.businesses, copy.businessSectionDescription, businessRows.length)}
          <div className="platform-table-wrap"><table className="platform-table" aria-label={copy.businesses}>
            <thead><tr><th>{copy.business}</th><th>{copy.requesterOwner}</th><th>{copy.statusFilter}</th><th>{copy.dates}</th><th>{copy.actions}</th></tr></thead>
            <tbody>{businessRows.length === 0 ? <tr><td colSpan={5}>{copy.empty}</td></tr> : businessRows.map((business) => <tr data-testid="business-record" key={business.id}>
              <td data-label={copy.business}><strong>{business.name}</strong><small>{business.id}</small></td>
              <td data-label={copy.requesterOwner}><span>{business.requesterId}</span><small>{copy.requesterOwner}</small></td>
              <td data-label={copy.statusFilter}><StatusBadge status={business.status} label={statusLabel(business.status)} /></td>
              <td data-label={copy.dates}><small>{copy.activated}: {dateFor(business.activatedAt, locale)}</small><small>{copy.serviceExpires}: {dateFor(business.serviceExpiresAt, locale)}</small></td>
              <td data-label={copy.actions}>{actionButtons("business", business.id, business.name, actionsForBusiness(business))}</td>
            </tr>)}</tbody>
          </table></div>
        </section>
      )}

      {(section === "all" || section === "projects") && (
        <section className="platform-section" aria-labelledby="platform-projects-title">
          {sectionHeader("platform-projects-title", copy.projects, copy.projectSectionDescription, projectRows.length)}
          <div className="platform-table-wrap"><table className="platform-table" aria-label={copy.projects}>
            <thead><tr><th>{copy.project}</th><th>{copy.business}</th><th>{copy.requesterOwner}</th><th>{copy.statusFilter}</th><th>{copy.dates}</th><th>{copy.actions}</th></tr></thead>
            <tbody>{projectRows.length === 0 ? <tr><td colSpan={6}>{copy.empty}</td></tr> : projectRows.map((project) => <tr key={project.id}>
              <td data-label={copy.project}><strong>{project.name}</strong><small>{project.id}</small></td>
              <td data-label={copy.business}>{project.businessId}</td>
              <td data-label={copy.requesterOwner}>{project.requesterId}</td>
              <td data-label={copy.statusFilter}><StatusBadge status={project.status} label={statusLabel(project.status)} /></td>
              <td data-label={copy.dates}><small>{copy.created}: {dateFor(project.createdAt, locale)}</small><small>{copy.activated}: {dateFor(project.activatedAt, locale)}</small><small>{copy.reviewed}: {dateFor(project.reviewedAt, locale)}</small></td>
              <td data-label={copy.actions}>{actionButtons("project", project.id, project.name, actionsForProject(project))}</td>
            </tr>)}</tbody>
          </table></div>
        </section>
      )}

      {(section === "all" || section === "administrators") && (
        <section className="platform-section" aria-labelledby="platform-administrators-title">
          {sectionHeader("platform-administrators-title", copy.administrators, copy.administratorSectionDescription, administratorRows.length)}
          <div className="platform-table-wrap"><table className="platform-table" aria-label={copy.administrators}>
            <thead><tr><th>{copy.administrator}</th><th>{copy.business}</th><th>{copy.role}</th><th>{copy.statusFilter}</th><th>{copy.actions}</th></tr></thead>
            <tbody>{administratorRows.length === 0 ? <tr><td colSpan={5}>{copy.empty}</td></tr> : administratorRows.map((administrator) => {
              const name = administrator.email ?? administrator.userId;
              return <tr key={administrator.membershipId}>
                <td data-label={copy.administrator}><strong>{name}</strong><small>{administrator.userId}</small></td>
                <td data-label={copy.business}>{administrator.businessId}<small>{statusLabel(administrator.businessStatus)}</small></td>
                <td data-label={copy.role}>{administrator.role}</td>
                <td data-label={copy.statusFilter}><StatusBadge status={administrator.status} label={statusLabel(administrator.status)} /></td>
                <td data-label={copy.actions}>{actionButtons("administrator", administrator.membershipId, name, actionsForAdministrator(administrator))}</td>
              </tr>;
            })}</tbody>
          </table></div>
        </section>
      )}

      {dialog && <ActionDialog
        open
        title={`${copy.confirmAction}: ${actionLabel(dialog.action)}`}
        description={`${copy.confirmDescription} ${dialog.name}`}
        actionLabel={busy ? copy.saving : copy.confirm}
        cancelLabel={copy.cancel}
        reasonLabel={copy.reason}
        reasonHint={copy.reasonHint}
        expirationLabel={copy.serviceExpiration}
        requiresReason={dialog.requiresReason}
        requiresExpiration={dialog.requiresExpiration}
        busy={busy}
        onCancel={() => { if (!busy) setDialog(null); }}
        onConfirm={(values) => { if (!busy) void submitAction(values); }}
      />}
    </div>
  );
}
