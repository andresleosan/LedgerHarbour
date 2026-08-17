import {
  assertRequiredMigrations,
  checkInitialMigration,
  checkPlatformControlPlaneMigration,
  checkBusinessLifecycleMigration,
  resolveMigrationConfig,
} from "../../src/db/migration-runner";

try {
  const config = resolveMigrationConfig();
  const initial = await checkInitialMigration(config);
  const platform = await checkPlatformControlPlaneMigration(config);
  const lifecycle = await checkBusinessLifecycleMigration(config);
  assertRequiredMigrations(initial, platform, lifecycle);
  console.log(`Verified: ${initial.version} + ${platform.version} + ${lifecycle.version} (${initial.requiredTableCount} initial tables, ${platform.requiredTableCount} platform tables, ${lifecycle.requiredTableCount} lifecycle columns, ledger records verified)`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Migration check failed");
  process.exitCode = 1;
}
