import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { Pool } from "pg";

import { createDbClient } from "../src/db/client";
import {
  createPostgresOnboardingRepository,
} from "../src/modules/tenancy/postgres-tenancy-repository";
import {
  executeServiceExpirationDryRun,
  type ServiceExpirationDryRunEnvironment,
  type ServiceExpirationDryRunCliDependencies,
} from "../src/modules/operations/service-expiration-dry-run";

function createDefaultDependencies(): ServiceExpirationDryRunCliDependencies {
  return {
    openRepository: async (databaseUrl) => {
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        return {
          repository: createPostgresOnboardingRepository(createDbClient(pool)),
          close: () => pool.end(),
        };
      } catch (error) {
        await pool.end().catch(() => undefined);
        throw error;
      }
    },
    now: () => new Date(),
    createRunId: () => randomUUID(),
  };
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  env: ServiceExpirationDryRunEnvironment = { DATABASE_URL: process.env.DATABASE_URL },
): Promise<0 | 1> {
  const result = await executeServiceExpirationDryRun(args, env, createDefaultDependencies());
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  return result.exitCode;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch(() => {
    console.error("Service expiration dry-run failed");
    process.exitCode = 1;
  });
}
