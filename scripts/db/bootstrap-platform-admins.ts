import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { Pool } from "pg";

import { createDbClient } from "../../src/db/client";
import {
  bootstrapPlatformAdmins,
  resolvePlatformAdminEmails,
} from "../../src/db/platform-bootstrap";

function hasExplicitEmailArgument(args: readonly string[]): boolean {
  return args.some((argument) => argument === "--emails" || argument.startsWith("--emails="));
}

const CONTROLLED_BOOTSTRAP_ENVIRONMENTS = new Set(["development", "test", "staging"]);
type PlatformBootstrapEnvironment = {
  NODE_ENV?: string;
  PLATFORM_ADMIN_BOOTSTRAP?: string;
  PLATFORM_ADMIN_EMAILS?: string;
};

export function resolvePlatformBootstrapEmails(
  args: readonly string[],
  env: PlatformBootstrapEnvironment,
): string[] {
  if (hasExplicitEmailArgument(args)) return resolvePlatformAdminEmails(args);
  if (env.NODE_ENV === "production") {
    throw new Error("Production bootstrap requires the explicit --emails argument");
  }
  if (!CONTROLLED_BOOTSTRAP_ENVIRONMENTS.has(env.NODE_ENV ?? "")) {
    throw new Error("Environment bootstrap requires a controlled non-production environment");
  }
  if (env.PLATFORM_ADMIN_BOOTSTRAP !== "true") {
    throw new Error("PLATFORM_ADMIN_BOOTSTRAP=true is required for environment bootstrap");
  }
  const configuredEmails = env.PLATFORM_ADMIN_EMAILS?.trim();
  if (!configuredEmails) throw new Error("PLATFORM_ADMIN_EMAILS is required for environment bootstrap");
  return resolvePlatformAdminEmails(["--emails", configuredEmails]);
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for platform bootstrap");

  const emails = resolvePlatformBootstrapEmails(args, env);
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await bootstrapPlatformAdmins(createDbClient(pool), emails);
    console.log(`Platform bootstrap complete: ${result.created} new administrator record(s)`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Platform bootstrap failed");
    process.exitCode = 1;
  });
}
