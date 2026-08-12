import { and, eq } from "drizzle-orm";

import type { Database } from "../../db/client";
import { databaseForOperation, transactionWithDatabase } from "../../db/transaction-scope";
import { documents } from "../../db/schema";
import {
  DOCUMENT_ERROR_CODES,
  DocumentError,
  type Document,
  type DocumentRepository,
} from "./document-service";
import type { BusinessId } from "../tenancy/types";

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
  if (typeof error.constraint_name === "string") return error.constraint_name;
  if (typeof error.detail === "string") return error.detail;
  const causeName = constraintName(error.cause);
  if (causeName) return causeName;
  return typeof error.message === "string" ? error.message : "";
}

function isDomainError(error: unknown): error is DocumentError {
  return error instanceof DocumentError;
}

function mapDatabaseError(error: unknown): DocumentError | null {
  if (isDomainError(error)) return error;
  const code = driverCode(error);
  if (!code) return null;
  const constraint = constraintName(error);
  if (code === "23505" && constraint === "documents_business_checksum_unique") {
    return new DocumentError(DOCUMENT_ERROR_CODES.DUPLICATE_CHECKSUM);
  }
  if (code === "23503" || code === "23505" || code === "23514" || code === "23523") {
    return new DocumentError(DOCUMENT_ERROR_CODES.STORAGE_FAILURE);
  }
  return new DocumentError(DOCUMENT_ERROR_CODES.STORAGE_FAILURE);
}

function preserveOrMap(error: unknown): never {
  if (error instanceof DocumentError) throw error;
  const mapped = mapDatabaseError(error);
  if (mapped) throw mapped;
  throw new DocumentError(DOCUMENT_ERROR_CODES.STORAGE_FAILURE);
}

function mapDocument(row: typeof documents.$inferSelect): Document {
  return {
    id: row.id,
    businessId: id<BusinessId>(row.businessId),
    uploaderId: id(row.uploaderId),
    privateObjectKey: row.privateObjectKey,
    originalFileName: row.originalFileName,
    originalMimeType: row.originalMimeType,
    originalSizeBytes: row.originalSizeBytes,
    checksum: row.checksum ?? "",
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

function createRepository(database: Database): DocumentRepository {
  const repository: DocumentRepository = {
    async transaction<T>(operation: () => Promise<T>): Promise<T> {
      try {
        return await transactionWithDatabase(database, operation);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async create(document) {
      const db = databaseForOperation(database);
      try {
        if (document.checksum) {
          const duplicate = await db.select({ id: documents.id }).from(documents).where(and(
            eq(documents.businessId, document.businessId),
            eq(documents.checksum, document.checksum),
          )).limit(1);
          if (duplicate.length > 0) throw new DocumentError(DOCUMENT_ERROR_CODES.DUPLICATE_CHECKSUM);
        }
        const [row] = await db.insert(documents).values({
          id: document.id,
          businessId: document.businessId,
          uploaderId: document.uploaderId,
          privateObjectKey: document.privateObjectKey,
          originalFileName: document.originalFileName,
          originalMimeType: document.originalMimeType,
          originalSizeBytes: document.originalSizeBytes,
          checksum: document.checksum || null,
          status: document.status,
          createdAt: new Date(document.createdAt),
          updatedAt: new Date(document.createdAt),
        }).returning();
        if (!row) throw new DocumentError(DOCUMENT_ERROR_CODES.STORAGE_FAILURE);
        return mapDocument(row);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async findById(documentId) {
      const db = databaseForOperation(database);
      try {
        const [row] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
        return row ? mapDocument(row) : null;
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async getStatus(documentId) {
      const document = await repository.findById(documentId);
      return document?.status ?? null;
    },

    async setStatus(documentId, status) {
      const db = databaseForOperation(database);
      try {
        const [row] = await db.update(documents).set({ status, updatedAt: new Date() }).where(eq(documents.id, documentId)).returning();
        return row ? mapDocument(row) : null;
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async listByBusinessId(businessId) {
      const db = databaseForOperation(database);
      try {
        const rows = await db.select().from(documents).where(eq(documents.businessId, businessId));
        return rows.map(mapDocument);
      } catch (error) {
        return preserveOrMap(error);
      }
    },
  };
  return repository;
}

export function createPostgresDocumentRepository(database: Database): DocumentRepository {
  return createRepository(database);
}
