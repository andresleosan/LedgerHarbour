import type { OnboardingRepository } from "../tenancy/business-service";
import type { BusinessStatus } from "../tenancy/types";

const UTC_DAY_MS = 24 * 60 * 60 * 1000;
const PRE_EXPIRATION_WINDOW_DAYS = [14, 7, 1] as const;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export const SERVICE_EXPIRATION_DRY_RUN_POLICY = {
  preExpirationWindowsDays: PRE_EXPIRATION_WINDOW_DAYS,
  gracePeriodDays: 3,
  eligibleStatuses: ["active"],
  recipientClass: "platform_admin",
} as const;

export const SERVICE_EXPIRATION_DRY_RUN_ERROR_CODES = {
  INVALID_SERVICE_EXPIRATION_TIMESTAMP: "INVALID_SERVICE_EXPIRATION_TIMESTAMP",
} as const;

export interface ServiceExpirationDryRunRecord {
  id: string;
  status: BusinessStatus;
  isActive: boolean;
  serviceExpiresAt: string | null;
}

export interface ServiceExpirationDryRunCounts {
  scanned: number;
  eligible: number;
  preExpiration14: number;
  preExpiration7: number;
  preExpiration1: number;
  gracePeriod: number;
  expiredAfterGrace: number;
  notInWindow: number;
  excluded: number;
  errors: number;
  deduplicationKeysComputed: number;
  duplicateKeys: number;
}

export interface ServiceExpirationDryRunResult {
  runId: string;
  asOf: string;
  timezone: "UTC";
  policy: typeof SERVICE_EXPIRATION_DRY_RUN_POLICY;
  counts: ServiceExpirationDryRunCounts;
  errorCodes: string[];
}

export interface ClassifyServiceExpirationDryRunInput {
  runId: string;
  asOf: Date;
  records: readonly ServiceExpirationDryRunRecord[];
}

export type ServiceExpirationDryRunRepository = Pick<OnboardingRepository, "listBusinesses">;

export interface ServiceExpirationDryRunRepositorySession {
  repository: ServiceExpirationDryRunRepository;
  close(): Promise<void>;
}

export interface ServiceExpirationDryRunCliDependencies {
  openRepository(databaseUrl: string): Promise<ServiceExpirationDryRunRepositorySession>;
  now(): Date;
  createRunId(): string;
}

export interface ServiceExpirationDryRunEnvironment {
  DATABASE_URL?: string;
}

export interface ServiceExpirationDryRunCliResult {
  exitCode: 0 | 1;
  stdout: string;
  stderr: string;
}

function utcDateStart(date: Date): number {
  if (Number.isNaN(date.getTime())) throw new Error("Invalid as-of date");
  const datePart = date.toISOString().slice(0, 10);
  return Date.parse(`${datePart}T00:00:00.000Z`);
}

function parseUtcTimestamp(value: string): Date | null {
  if (!ISO_INSTANT_PATTERN.test(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  return parsed;
}

function isValidPostgresDatabaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function classifyServiceExpirationDryRun(
  input: ClassifyServiceExpirationDryRunInput,
): ServiceExpirationDryRunResult {
  const asOfDateStart = utcDateStart(input.asOf);
  const counts: ServiceExpirationDryRunCounts = {
    scanned: input.records.length,
    eligible: 0,
    excluded: 0,
    preExpiration14: 0,
    preExpiration7: 0,
    preExpiration1: 0,
    gracePeriod: 0,
    expiredAfterGrace: 0,
    notInWindow: 0,
    errors: 0,
    deduplicationKeysComputed: 0,
    duplicateKeys: 0,
  };
  const errorCodes = new Set<string>();
  const deduplicationKeys = new Set<string>();

  for (const record of input.records) {
    if (record.serviceExpiresAt === null) {
      counts.excluded += 1;
      continue;
    }

    const expiration = parseUtcTimestamp(record.serviceExpiresAt);
    if (!expiration) {
      counts.errors += 1;
      errorCodes.add(SERVICE_EXPIRATION_DRY_RUN_ERROR_CODES.INVALID_SERVICE_EXPIRATION_TIMESTAMP);
      continue;
    }

    if (record.status !== "active" || !record.isActive) {
      counts.excluded += 1;
      continue;
    }

    counts.eligible += 1;
    const expirationDateStart = utcDateStart(expiration);
    const daysRemaining = Math.round((expirationDateStart - asOfDateStart) / UTC_DAY_MS);
    let windowId: string;

    if (daysRemaining === 14) {
      counts.preExpiration14 += 1;
      windowId = "pre_expiration_14";
    } else if (daysRemaining === 7) {
      counts.preExpiration7 += 1;
      windowId = "pre_expiration_7";
    } else if (daysRemaining === 1) {
      counts.preExpiration1 += 1;
      windowId = "pre_expiration_1";
    } else if (daysRemaining <= 0 && daysRemaining >= -SERVICE_EXPIRATION_DRY_RUN_POLICY.gracePeriodDays) {
      counts.gracePeriod += 1;
      windowId = "grace_period";
    } else if (daysRemaining < -SERVICE_EXPIRATION_DRY_RUN_POLICY.gracePeriodDays) {
      counts.expiredAfterGrace += 1;
      windowId = "expired_after_grace";
    } else {
      counts.notInWindow += 1;
      windowId = "not_in_window";
    }

    const deduplicationKey = `${record.id}|service_expiration|${windowId}|${record.serviceExpiresAt}`;
    counts.deduplicationKeysComputed += 1;
    if (deduplicationKeys.has(deduplicationKey)) {
      counts.duplicateKeys += 1;
    } else {
      deduplicationKeys.add(deduplicationKey);
    }
  }

  return {
    runId: input.runId,
    asOf: input.asOf.toISOString(),
    timezone: "UTC",
    policy: SERVICE_EXPIRATION_DRY_RUN_POLICY,
    counts,
    errorCodes: [...errorCodes],
  };
}

export function parseServiceExpirationDryRunArgs(
  args: readonly string[],
): { asOf: Date | undefined } | { error: string } {
  let asOf: Date | undefined;

  for (const argument of args) {
    if (!argument.startsWith("--as-of=")) return { error: "Unknown argument" };
    if (asOf) return { error: "Duplicate --as-of argument" };

    const value = argument.slice("--as-of=".length);
    const parsed = parseUtcTimestamp(value);
    if (!parsed) return { error: "Invalid --as-of value" };
    asOf = parsed;
  }

  return { asOf };
}

export async function executeServiceExpirationDryRun(
  args: readonly string[],
  env: ServiceExpirationDryRunEnvironment,
  dependencies: ServiceExpirationDryRunCliDependencies,
): Promise<ServiceExpirationDryRunCliResult> {
  const parsedArgs = parseServiceExpirationDryRunArgs(args);
  if ("error" in parsedArgs) return { exitCode: 1, stdout: "", stderr: parsedArgs.error };

  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return { exitCode: 1, stdout: "", stderr: "DATABASE_URL is required for service expiration dry-run" };
  }
  if (!isValidPostgresDatabaseUrl(databaseUrl)) {
    return { exitCode: 1, stdout: "", stderr: "Invalid DATABASE_URL for service expiration dry-run" };
  }
  try {
    const parsedDatabaseUrl = new URL(databaseUrl);
    if (![("postgres:"), ("postgresql:")].includes(parsedDatabaseUrl.protocol) || !parsedDatabaseUrl.hostname) {
      return { exitCode: 1, stdout: "", stderr: "Invalid DATABASE_URL for service expiration dry-run" };
    }
  } catch {
    return { exitCode: 1, stdout: "", stderr: "Invalid DATABASE_URL for service expiration dry-run" };
  }

  let session: ServiceExpirationDryRunRepositorySession | undefined;
  try {
    session = await dependencies.openRepository(databaseUrl);
    const businesses = await session.repository.listBusinesses();
    const result = classifyServiceExpirationDryRun({
      runId: dependencies.createRunId(),
      asOf: parsedArgs.asOf ?? dependencies.now(),
      records: businesses.map(({ id, status, isActive, serviceExpiresAt }) => ({ id, status, isActive, serviceExpiresAt })),
    });
    return {
      exitCode: result.counts.errors === 0 ? 0 : 1,
      stdout: JSON.stringify(result),
      stderr: "",
    };
  } catch {
    return { exitCode: 1, stdout: "", stderr: "Service expiration dry-run read failed" };
  } finally {
    if (session) {
      try {
        await session.close();
      } catch {
        // Closing a read-only preview must not leak provider errors to stdout.
      }
    }
  }
}
