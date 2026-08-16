import { applyInitialMigration, resolveMigrationConfig } from "../../src/db/migration-runner";

try {
  const result = await applyInitialMigration(resolveMigrationConfig());
  console.log(`${result.applied ? "Applied" : "Already applied"}: ${result.version}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Migration failed");
  process.exitCode = 1;
}
