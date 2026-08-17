import { checkAllMigrations, resolveMigrationConfig } from "../../src/db/migration-runner";

try {
  const config = resolveMigrationConfig();
  const { initial, platform, lifecycle, membershipLifecycle, projects } = await checkAllMigrations(config);
  console.log(`Verified: ${initial.version} + ${platform.version} + ${lifecycle.version} + ${membershipLifecycle.version} + ${projects.version} (${initial.requiredTableCount} initial tables, ${platform.requiredTableCount} platform tables, ${lifecycle.requiredTableCount} lifecycle columns, ${membershipLifecycle.requiredTableCount} membership lifecycle columns, ${projects.requiredTableCount} project tables, ledger records verified)`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Migration check failed");
  process.exitCode = 1;
}
