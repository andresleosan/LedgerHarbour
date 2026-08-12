import { and, eq, lt, or } from "drizzle-orm";

import type { Database } from "../../db/client";
import { databaseForOperation, transactionWithDatabase } from "../../db/transaction-scope";
import { jobs } from "../../db/schema";
import {
  JOB_ERROR_CODES,
  JobError,
  type Job,
  type JobRepository,
} from "./job-service";
import type { DocumentId } from "../invoices/ocr-provider";
import type { BusinessId, UserId } from "../tenancy/types";

const MAX_RETRY_COUNT = 3;

function id<T extends string>(value: string): T {
  return value as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function driverCode(error: unknown): string | null {
  if (!isRecord(error)) return null;
  if (typeof error.code === "string") return error.code;
  return driverCode(error.cause);
}

function constraintName(error: unknown): string {
  if (!isRecord(error)) return "";
  if (typeof error.constraint === "string") return error.constraint;
  if (typeof error.detail === "string") return error.detail;
  return constraintName(error.cause);
}

function mapDatabaseError(error: unknown): JobError | null {
  if (error instanceof JobError) return error;
  const code = driverCode(error);
  if (!code) return null;
  if (code === "23505" && constraintName(error).includes("jobs_business_document_type_unique")) {
    return new JobError(JOB_ERROR_CODES.OCR_JOB_CONFLICT);
  }
  return new JobError(JOB_ERROR_CODES.OCR_JOB_CONFLICT);
}

function preserveOrMap(error: unknown): never {
  if (error instanceof JobError) throw error;
  const mapped = mapDatabaseError(error);
  if (mapped) throw mapped;
  throw new JobError(JOB_ERROR_CODES.OCR_JOB_CONFLICT);
}

function mapJob(row: typeof jobs.$inferSelect): Job {
  return {
    id: row.id,
    businessId: id<BusinessId>(row.businessId),
    documentId: id<DocumentId>(row.documentId),
    jobType: "ocr",
    status: row.status,
    retryCount: row.retryCount,
    errorSummary: row.errorSummary,
    requestedBy: id<UserId>(row.requestedBy),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function createRepository(database: Database): JobRepository {
  const repository: JobRepository = {
    async transaction<T>(operation: () => Promise<T>): Promise<T> {
      try {
        return await transactionWithDatabase(database, operation);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async create(job) {
      const db = databaseForOperation(database);
      try {
        const [row] = await db.insert(jobs).values({
          id: job.id,
          businessId: job.businessId,
          documentId: job.documentId,
          requestedBy: job.requestedBy,
          jobType: job.jobType,
          status: job.status,
          retryCount: job.retryCount,
          errorSummary: job.errorSummary,
          createdAt: new Date(job.createdAt),
          updatedAt: new Date(job.updatedAt),
        }).returning();
        if (!row) throw new JobError(JOB_ERROR_CODES.OCR_JOB_CONFLICT);
        return mapJob(row);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async findById(jobId) {
      const db = databaseForOperation(database);
      try {
        const [row] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
        return row ? mapJob(row) : null;
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async findByDocumentId(documentId) {
      const db = databaseForOperation(database);
      try {
        const [row] = await db.select().from(jobs).where(and(
          eq(jobs.documentId, documentId),
          eq(jobs.jobType, "ocr"),
        )).limit(1);
        return row ? mapJob(row) : null;
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async createOrReuse(factory) {
      return repository.transaction(async () => {
        const candidate = factory();
        const db = databaseForOperation(database);
        try {
          const [inserted] = await db.insert(jobs).values({
            id: candidate.id,
            businessId: candidate.businessId,
            documentId: candidate.documentId,
            requestedBy: candidate.requestedBy,
            jobType: candidate.jobType,
            status: candidate.status,
            retryCount: candidate.retryCount,
            errorSummary: candidate.errorSummary,
            createdAt: new Date(candidate.createdAt),
            updatedAt: new Date(candidate.updatedAt),
          }).onConflictDoNothing({
            target: [jobs.businessId, jobs.documentId, jobs.jobType],
          }).returning();
          if (inserted) return mapJob(inserted);

          const [existing] = await db.select().from(jobs).where(and(
            eq(jobs.businessId, candidate.businessId),
            eq(jobs.documentId, candidate.documentId),
            eq(jobs.jobType, candidate.jobType),
          )).limit(1);
          if (!existing) throw new JobError(JOB_ERROR_CODES.OCR_JOB_CONFLICT);
          if (existing.status === "queued" || existing.status === "processing") return mapJob(existing);
          throw new JobError(JOB_ERROR_CODES.OCR_JOB_CONFLICT);
        } catch (error) {
          return preserveOrMap(error);
        }
      });
    },

    async claim(jobId) {
      const db = databaseForOperation(database);
      try {
        const [row] = await db.update(jobs).set({
          status: "processing",
          updatedAt: new Date(),
        }).where(and(
          eq(jobs.id, jobId),
          or(
            eq(jobs.status, "queued"),
            and(eq(jobs.status, "failed"), lt(jobs.retryCount, MAX_RETRY_COUNT)),
          ),
        )).returning();
        return row ? mapJob(row) : null;
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async update(job) {
      const db = databaseForOperation(database);
      try {
        const [row] = await db.update(jobs).set({
          documentId: job.documentId,
          requestedBy: job.requestedBy,
          jobType: job.jobType,
          status: job.status,
          retryCount: job.retryCount,
          errorSummary: job.errorSummary,
          updatedAt: new Date(job.updatedAt),
        }).where(and(
          eq(jobs.id, job.id),
          eq(jobs.businessId, job.businessId),
        )).returning();
        if (!row) throw new JobError(JOB_ERROR_CODES.JOB_NOT_FOUND);
        return mapJob(row);
      } catch (error) {
        if (error instanceof JobError) throw error;
        return preserveOrMap(error);
      }
    },
  };
  return repository;
}

export function createPostgresJobRepository(database: Database): JobRepository {
  return createRepository(database);
}
