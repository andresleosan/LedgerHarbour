import type { AuthIdentity } from "@/modules/auth/auth-provider";
import { redirect } from "next/navigation";
import { getPlatformSummary } from "@/modules/platform/platform-summary";
import { getPersistenceContext } from "@/modules/persistence/repository-factory";
import { PlatformError, PLATFORM_ERROR_CODES } from "@/modules/platform/platform-service";
import { ProjectError, PROJECT_ERROR_CODES } from "@/modules/projects/project-service";

export async function loadPlatformSummary(identity: AuthIdentity) {
  const persistence = getPersistenceContext();
  try {
    return await getPlatformSummary(identity, {
      tenancyRepository: persistence.tenancyRepository,
      platformRepository: persistence.platformRepository,
      projectRepository: persistence.projectRepository,
    });
  } catch (error) {
    if ((error instanceof PlatformError && error.code === PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED)
      || (error instanceof ProjectError && error.code === PROJECT_ERROR_CODES.PLATFORM_ACCESS_DENIED)) {
      redirect("/portfolio");
    }
    throw error;
  }
}
