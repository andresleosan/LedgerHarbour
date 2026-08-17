"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";

export type ProjectQueueItem = {
  id: string;
  name: string;
  businessId: string;
  requesterId: string;
  status: "pending" | "active" | "rejected" | "suspended";
};

type ProjectAction = "approve" | "reject" | "suspend" | "reactivate";

const actionLabels: Record<ProjectAction, string> = {
  approve: "Approve",
  reject: "Reject",
  suspend: "Suspend",
  reactivate: "Reactivate",
};

function requiresReason(action: ProjectAction): boolean {
  return action === "reject" || action === "suspend";
}

export default function ProjectQueue({ projects }: { projects: ProjectQueueItem[] }) {
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>, project: ProjectQueueItem, action: ProjectAction) => {
    event.preventDefault();
    setError(null);
    const reason = new FormData(event.currentTarget).get("reason");
    if (requiresReason(action) && (typeof reason !== "string" || !reason.trim())) {
      setError("A reason is required for this action.");
      return;
    }
    const key = `${project.id}:${action}`;
    setBusyAction(key);
    try {
      const response = await fetch(`/api/platform/projects/${project.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(typeof reason === "string" && reason.trim() ? { reason } : {}),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message ?? "The project action could not be completed.");
      }
      router.refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The project action could not be completed.");
    } finally {
      setBusyAction(null);
    }
  };

  const actionsFor = (project: ProjectQueueItem): ProjectAction[] => {
    if (project.status === "pending") return ["approve", "reject"];
    if (project.status === "active") return ["suspend"];
    if (project.status === "suspended") return ["reactivate"];
    return [];
  };

  return (
    <>
      {error && <p role="alert" style={{ color: "#913f35", fontWeight: 750 }}>{error}</p>}
      {projects.length === 0 ? <p style={{ color: "#49636b" }}>No projects match this filter.</p> : <ul style={{ display: "grid", gap: 10, margin: 0, padding: 0, listStyle: "none" }}>{projects.map((project) => <li key={project.id} style={{ display: "grid", gap: 14, padding: 16, border: "1px solid #cbd9d5", borderRadius: 12, background: "#fff" }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 16 }}><span><strong>{project.name}</strong><small style={{ display: "block", marginTop: 5, color: "#49636b" }}>{project.businessId} / {project.requesterId}</small></span><strong style={{ color: project.status === "active" ? "#075b57" : "#793e35" }}>{project.status}</strong></div>
        {actionsFor(project).length > 0 && <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 8 }}>{actionsFor(project).map((action) => <form key={action} onSubmit={(event) => void submit(event, project, action)} style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 8 }}>
          {requiresReason(action) && <label style={{ display: "grid", gap: 4, color: "#49636b", fontSize: ".82rem" }}>Reason<input name="reason" maxLength={1000} required style={{ minHeight: 38, border: "1px solid #9fbab1", borderRadius: 7, padding: "7px 9px", font: "inherit" }} /></label>}
          <button type="submit" aria-label={`${actionLabels[action]} ${project.name}`} disabled={busyAction !== null} style={{ minHeight: 38, border: "1px solid #0b7772", borderRadius: 7, padding: "0 11px", background: action === "approve" || action === "reactivate" ? "#0b7772" : "#fff", color: action === "approve" || action === "reactivate" ? "#fff" : "#793e35", cursor: busyAction === null ? "pointer" : "wait", font: "inherit", fontWeight: 750 }}>{busyAction === `${project.id}:${action}` ? "Saving..." : actionLabels[action]}</button>
        </form>)}</div>}
      </li>)}</ul>}
    </>
  );
}
