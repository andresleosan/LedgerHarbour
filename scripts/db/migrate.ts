import { applyAllMigrations, resolveMigrationConfig } from "../../src/db/migration-runner";

try {
  const config = resolveMigrationConfig();
  const { initial, platform, lifecycle, membershipLifecycle, projects } = await applyAllMigrations(config);
  console.log(`${initial.applied ? "Applied" : "Already applied"}: ${initial.version}`);
  console.log(`${platform.applied ? "Applied" : "Already applied"}: ${platform.version}`);
  console.log(`${lifecycle.applied ? "Applied" : "Already applied"}: ${lifecycle.version}`);
  console.log(`${membershipLifecycle.applied ? "Applied" : "Already applied"}: ${membershipLifecycle.version}`);
  console.log(`${projects.applied ? "Applied" : "Already applied"}: ${projects.version}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Migration failed");
  process.exitCode = 1;
}
