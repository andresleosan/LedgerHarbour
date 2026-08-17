import { Pool } from "pg";

import { createDbClient, type Database } from "../../db/client";
import { resolveDefaultCurrencyRepository } from "../accounting/currency-service";
import { createPostgresCurrencyRepository } from "../accounting/postgres-currency-repository";
import { resolveDefaultDocumentRepository, resolveDefaultInvoiceRepository } from "../invoices/invoice-service";
import { createPostgresInvoiceRepository } from "../invoices/postgres-invoice-repository";
import { resolveDefaultJobRepository } from "../jobs/job-service";
import { createPostgresJobRepository } from "../jobs/postgres-job-repository";
import { createPostgresDocumentRepository } from "../documents/postgres-document-repository";
import { resolveDefaultStorage } from "../invoices/invoice-service";
import { createPostgresOnboardingRepository } from "../tenancy/postgres-tenancy-repository";
import { defaultOnboardingRepository, type OnboardingRepository } from "../tenancy/business-service";
import { createPostgresPlatformRepository, defaultPlatformRepository } from "../platform/platform-service";
import { createPostgresProjectRepository, defaultProjectRepository } from "../projects/project-service";
import type { ProjectRepository } from "../projects/project-repository";
import type { PlatformRepository } from "../platform/platform-repository";
import type { DocumentRepository } from "../documents/document-service";
import type { InvoiceRepository } from "../invoices/invoice-service";
import type { JobRepository } from "../jobs/job-service";
import type { CurrencyRepository } from "../accounting/currency-service";
import type { StorageAdapter } from "../documents/storage-adapter";

export type PersistenceMode = "memory" | "postgres";

export type PersistenceContext = {
  mode: PersistenceMode;
  tenancyRepository: OnboardingRepository;
  platformRepository: PlatformRepository;
  projectRepository: ProjectRepository;
  documentRepository: DocumentRepository;
  invoiceRepository: InvoiceRepository;
  jobRepository: JobRepository;
  currencyRepository: CurrencyRepository;
  storage: StorageAdapter;
  database?: Database;
  transaction?: <T>(operation: (tenancyRepository: OnboardingRepository) => Promise<T>) => Promise<T>;
  close(): Promise<void>;
};

export class PersistenceConfigurationError extends Error {
  readonly name = "PersistenceConfigurationError";
}

type PersistenceInput = {
  mode?: string;
  databaseUrl?: string;
  database?: Database;
};

const runtimeContexts = new Map<string, PersistenceContext>();
let runtimeContextKey: string | null = null;

function configurationError(message: string): PersistenceConfigurationError {
  return new PersistenceConfigurationError(message);
}

function resolveMode(input: PersistenceInput): PersistenceMode {
  const mode = (input.mode ?? process.env.PERSISTENCE_MODE ?? "memory").trim().toLowerCase();
  if (mode !== "memory" && mode !== "postgres") {
    throw configurationError("Unsupported persistence mode.");
  }
  return mode;
}

function resolveDatabaseUrl(input: PersistenceInput): string | undefined {
  const value = input.databaseUrl ?? process.env.DATABASE_URL;
  const databaseUrl = typeof value === "string" ? value.trim() : "";
  return databaseUrl || undefined;
}

export function createPersistenceContext(input: PersistenceInput = {}): PersistenceContext {
  const mode = resolveMode(input);
  const storage = resolveDefaultStorage();

  if (mode === "memory") {
    return {
      mode,
      tenancyRepository: defaultOnboardingRepository,
      platformRepository: defaultPlatformRepository,
      projectRepository: defaultProjectRepository,
      documentRepository: resolveDefaultDocumentRepository(),
      invoiceRepository: resolveDefaultInvoiceRepository(),
      jobRepository: resolveDefaultJobRepository(),
      currencyRepository: resolveDefaultCurrencyRepository(),
      storage,
      close: async () => {},
    };
  }

  const databaseUrl = resolveDatabaseUrl(input);
  if (!input.database && !databaseUrl) {
    throw configurationError("DATABASE_URL is required for postgres persistence.");
  }

  if (input.database) {
    return postgresContext(input.database, undefined, storage);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  return postgresContext(createDbClient(pool), pool, storage);
}

function postgresContext(database: Database, pool: Pool | undefined, storage: StorageAdapter): PersistenceContext {
  let closed = false;
  return {
    mode: "postgres",
    tenancyRepository: createPostgresOnboardingRepository(database),
    platformRepository: createPostgresPlatformRepository(database),
    projectRepository: createPostgresProjectRepository(database),
    documentRepository: createPostgresDocumentRepository(database),
    invoiceRepository: createPostgresInvoiceRepository(database),
    jobRepository: createPostgresJobRepository(database),
    currencyRepository: createPostgresCurrencyRepository(database),
    storage,
    database,
    transaction: async (operation) => {
      return createPostgresOnboardingRepository(database).transaction(operation);
    },
    close: async () => {
      if (!pool || closed) return;
      closed = true;
      await pool.end();
    },
  };
}

export function getPersistenceContext(): PersistenceContext {
  const mode = resolveMode({});
  const databaseUrl = mode === "postgres" ? resolveDatabaseUrl({}) ?? "" : "";
  const key = `${mode}:${databaseUrl}`;
  if (runtimeContextKey !== null && runtimeContextKey !== key) {
    const staleContexts = [...runtimeContexts.values()];
    runtimeContexts.clear();
    for (const staleContext of staleContexts) void staleContext.close().catch(() => {});
  }
  const existing = runtimeContexts.get(key);
  if (existing) return existing;

  const context = createPersistenceContext({ mode, databaseUrl: databaseUrl || undefined });
  runtimeContexts.set(key, context);
  runtimeContextKey = key;
  return context;
}

export async function resetPersistenceContextForTests(): Promise<void> {
  const contexts = [...runtimeContexts.values()];
  runtimeContexts.clear();
  runtimeContextKey = null;
  await Promise.all(contexts.map((context) => context.close()));
}
