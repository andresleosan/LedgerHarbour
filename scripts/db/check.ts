import { checkInitialMigration, resolveMigrationConfig } from "../../src/db/migration-runner";

try {
  const result = await checkInitialMigration(resolveMigrationConfig());
  if (!result.applied || result.requiredTableCount === 0) {
    throw new Error("Required PostgreSQL migration is not applied");
  }
  console.log(`Verified: ${result.version} (${result.requiredTableCount} required tables)`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Migration check failed");
  process.exitCode = 1;
}
