import {
  assertRequiredMigrations,
  checkInitialMigration,
  checkPlatformControlPlaneMigration,
  resolveMigrationConfig,
} from "../../src/db/migration-runner";

try {
  const config = resolveMigrationConfig();
  const initial = await checkInitialMigration(config);
  const platform = await checkPlatformControlPlaneMigration(config);
  assertRequiredMigrations(initial, platform);
  console.log(`Verified: ${initial.version} + ${platform.version} (${initial.requiredTableCount + platform.requiredTableCount} required objects)`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Migration check failed");
  process.exitCode = 1;
}
