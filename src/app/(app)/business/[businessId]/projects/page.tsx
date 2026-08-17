"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

import { useUrlLocale } from "@/ui/useUrlLocale";

type Project = {
  id: string;
  name: string;
  status: "pending" | "active" | "rejected" | "suspended";
  statusReason: string | null;
  createdAt: string;
};

const copy = {
  en: {
    back: "Workspace / Projects",
    eyebrow: "Business projects",
    title: "Request a project",
    description: "Project requests stay pending until a platform administrator approves them.",
    label: "Project name",
    placeholder: "e.g. North region",
    submit: "Submit request",
    submitting: "Submitting...",
    pending: "Pending approval",
    active: "Active",
    rejected: "Rejected",
    suspended: "Suspended",
    empty: "No project requests yet.",
    error: "The project request could not be completed.",
    invalid: "Enter a project name.",
  },
  es: {
    back: "Espacio de trabajo / Proyectos",
    eyebrow: "Proyectos del negocio",
    title: "Solicitar un proyecto",
    description: "Las solicitudes quedan pendientes hasta que un administrador de plataforma las apruebe.",
    label: "Nombre del proyecto",
    placeholder: "p. ej. Región norte",
    submit: "Enviar solicitud",
    submitting: "Enviando...",
    pending: "Pendiente de aprobación",
    active: "Activo",
    rejected: "Rechazado",
    suspended: "Suspendido",
    empty: "Todavía no hay solicitudes de proyecto.",
    error: "No se pudo completar la solicitud del proyecto.",
    invalid: "Escribe un nombre de proyecto.",
  },
} as const;

export default function ProjectsPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = use(params);
  const { locale, hrefFor } = useUrlLocale();
  const text = copy[locale];
  const [name, setName] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const response = await fetch(`/api/businesses/${businessId}/projects`, { cache: "no-store" });
    const payload = await response.json() as { projects?: Project[] };
    if (!response.ok) throw new Error(text.error);
    setProjects(payload.projects ?? []);
  };

  useEffect(() => { void load().catch(() => setError(text.error)); }, [businessId, text.error]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!name.trim()) { setError(text.invalid); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/businesses/${businessId}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(text.error);
      setName("");
      await load();
    } catch {
      setError(text.error);
    } finally {
      setBusy(false);
    }
  };

  const labelFor = (status: Project["status"]) => ({ pending: text.pending, active: text.active, rejected: text.rejected, suspended: text.suspended }[status]);

  return (
    <main className="operational-page project-page">
      <style>{`.project-page{max-width:900px}.project-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:end;margin:24px 0}.project-field{display:grid;gap:7px;font-weight:750}.project-input{width:100%;min-height:44px;border:1px solid #9fbab1;border-radius:9px;padding:10px 12px;color:#17313b;background:#fff;font:inherit}.project-input:focus-visible,.project-button:focus-visible,.project-back:focus-visible{outline:3px solid #8b452f;outline-offset:3px}.project-button{min-height:44px;border:1px solid #0b7772;border-radius:9px;padding:0 14px;background:#0b7772;color:#fff;cursor:pointer;font:inherit;font-weight:800}.project-button:disabled{cursor:wait;opacity:.6}.project-list{display:grid;gap:10px;margin:0;padding:0;list-style:none}.project-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:center;padding:16px;border:1px solid #cbd9d5;border-radius:12px;background:#fff}.project-row h2{margin:0;font-size:1rem;overflow-wrap:anywhere}.project-row p{margin:6px 0 0;color:#49636b;font-size:.84rem}.project-status{display:inline-flex;align-items:center;border-radius:999px;padding:5px 9px;background:#e8efed;color:#315b60;font-size:.74rem;font-weight:850;white-space:nowrap}.project-status.active{background:#d9eeea;color:#075b57}.project-status.rejected,.project-status.suspended{background:#f4dbd2;color:#793e35}.project-error{color:#913f35;font-weight:750}.project-empty{color:#49636b}@media(max-width:600px){.project-form,.project-row{grid-template-columns:1fr}.project-button{width:100%}.project-status{width:max-content}}@media(prefers-reduced-motion:reduce){.project-button{transition:none}}`}</style>
      <Link className="project-back page-back" href={hrefFor(`/business/${businessId}`)}>{text.back}</Link>
      <section className="page-card" aria-labelledby="projects-title">
        <p className="page-eyebrow">{text.eyebrow}</p>
        <h1 className="page-title" id="projects-title">{text.title}</h1>
        <p className="page-description">{text.description}</p>
        <form className="project-form" onSubmit={submit} noValidate>
          <label className="project-field" htmlFor="project-name">{text.label}<input className="project-input" id="project-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={text.placeholder} /></label>
          <button className="project-button" type="submit" disabled={busy}>{busy ? text.submitting : text.submit}</button>
        </form>
        {error && <p className="project-error" role="alert">{error}</p>}
        {projects.length === 0 ? <p className="project-empty">{text.empty}</p> : <ul className="project-list">{projects.map((project) => <li className="project-row" key={project.id}><div><h2>{project.name}</h2><p>{project.statusReason ?? project.createdAt}</p></div><span className={`project-status ${project.status}`}>{labelFor(project.status)}</span></li>)}</ul>}
      </section>
    </main>
  );
}
