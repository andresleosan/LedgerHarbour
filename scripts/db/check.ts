import {
  assertRequiredMigrations,
  checkInitialMigration,
  checkPlatformControlPlaneMigration,
  checkBusinessLifecycleMigration,
  checkMembershipLifecycleMigration,
  resolveMigrationConfig,
} from "../../src/db/migration-runner";

try {
  const config = resolveMigrationConfig();
  const initial = await checkInitialMigration(config);
  const platform = await checkPlatformControlPlaneMigration(config);
  const lifecycle = await checkBusinessLifecycleMigration(config);
  const membershipLifecycle = await checkMembershipLifecycleMigration(config);
  assertRequiredMigrations(initial, platform, lifecycle, membershipLifecycle);
  console.log(`Verified: ${initial.version} + ${platform.version} + ${lifecycle.version} + ${membershipLifecycle.version} (${initial.requiredTableCount} initial tables, ${platform.requiredTableCount} platform tables, ${lifecycle.requiredTableCount} lifecycle columns, ${membershipLifecycle.requiredTableCount} membership lifecycle columns, ledger records verified)`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Migration check failed");
  process.exitCode = 1;
}
