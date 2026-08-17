import { redirect } from "next/navigation";

import { getCurrentIdentity } from "@/modules/auth/session";
import { getPersistenceContext } from "@/modules/persistence/repository-factory";
import { createProjectService, ProjectError, PROJECT_ERROR_CODES } from "@/modules/projects/project-service";
import ProjectQueue, { type ProjectQueueItem } from "./project-queue";

export default async function PlatformProjectsPage({ searchParams }: { searchParams?: Promise<{ status?: string }> }) {
  const identity = await getCurrentIdentity();
  if (!identity) redirect("/login");
  const status = (await searchParams)?.status;
  const validStatus = status === "pending" || status === "active" || status === "rejected" || status === "suspended" ? status : undefined;
  try {
    const persistence = getPersistenceContext();
    const projects = await createProjectService({
      tenancyRepository: persistence.tenancyRepository,
      projectRepository: persistence.projectRepository,
      platformRepository: persistence.platformRepository,
    }).listProjects(identity, validStatus);
    return (
      <main style={{ maxWidth: 1050, margin: "0 auto", padding: "32px 20px", color: "#17313b", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
        <p style={{ color: "#0b7772", fontSize: ".74rem", fontWeight: 850, letterSpacing: ".14em", textTransform: "uppercase" }}>Platform queue</p>
        <h1 style={{ fontSize: "clamp(2rem, 5vw, 4rem)", letterSpacing: "-.05em", margin: 0 }}>Project requests</h1>
        <p style={{ color: "#49636b", lineHeight: 1.6 }}>Review project requests without opening the full administration panel.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "22px 0" }}>{["all", "pending", "active", "rejected", "suspended"].map((item) => <a key={item} href={item === "all" ? "/admin/projects" : `/admin/projects?status=${item}`} style={{ border: "1px solid #9bb7b0", borderRadius: 999, padding: "8px 12px", color: "#315b60", textDecoration: "none", fontWeight: 750 }}>{item}</a>)}</div>
        <ProjectQueue projects={projects as ProjectQueueItem[]} />
      </main>
    );
  } catch (error) {
    if (error instanceof ProjectError && error.code === PROJECT_ERROR_CODES.PLATFORM_ACCESS_DENIED) redirect("/portfolio");
    throw error;
  }
}
