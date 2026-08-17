import {
  applyInitialMigration,
  applyPlatformControlPlaneMigration,
  applyBusinessLifecycleMigration,
  applyMembershipLifecycleMigration,
  resolveMigrationConfig,
} from "../../src/db/migration-runner";

try {
  const config = resolveMigrationConfig();
  const initial = await applyInitialMigration(config);
  const platform = await applyPlatformControlPlaneMigration(config);
  const lifecycle = await applyBusinessLifecycleMigration(config);
  const membershipLifecycle = await applyMembershipLifecycleMigration(config);
  console.log(`${initial.applied ? "Applied" : "Already applied"}: ${initial.version}`);
  console.log(`${platform.applied ? "Applied" : "Already applied"}: ${platform.version}`);
  console.log(`${lifecycle.applied ? "Applied" : "Already applied"}: ${lifecycle.version}`);
  console.log(`${membershipLifecycle.applied ? "Applied" : "Already applied"}: ${membershipLifecycle.version}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Migration failed");
  process.exitCode = 1;
}
