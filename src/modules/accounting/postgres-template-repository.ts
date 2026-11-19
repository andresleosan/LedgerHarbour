import { eq } from "drizzle-orm";

import type { Database } from "../../db/client";
import { databaseForOperation, transactionWithDatabase } from "../../db/transaction-scope";
import { businessTemplates } from "../../db/schema";
import {
  TEMPLATE_ERROR_CODES,
  TemplateError,
  type BusinessTemplate,
  type StoredTemplateProfile,
  type TemplateRepository,
} from "./template-service";
import type { BusinessId, UserId } from "../tenancy/types";

function preserveOrMap(error: unknown): never {
  if (error instanceof TemplateError) throw error;
  throw new TemplateError(TEMPLATE_ERROR_CODES.TEMPLATE_REPOSITORY_CONFLICT);
}

function mapTemplate(row: typeof businessTemplates.$inferSelect): BusinessTemplate {
  return {
    id: row.id,
    businessId: row.businessId as BusinessId,
    privateObjectKey: row.privateObjectKey,
    originalFileName: row.originalFileName,
    sizeBytes: row.sizeBytes,
    checksum: row.checksum,
    profile: row.profile as StoredTemplateProfile,
    uploadedBy: row.uploadedBy as UserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createPostgresTemplateRepository(database: Database): TemplateRepository {
  return {
    async transaction<T>(operation: () => Promise<T>): Promise<T> {
      try {
        return await transactionWithDatabase(database, operation);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async findByBusinessId(businessId) {
      const db = databaseForOperation(database);
      try {
        const [row] = await db.select().from(businessTemplates).where(eq(businessTemplates.businessId, businessId)).limit(1);
        return row ? mapTemplate(row) : null;
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async upsert(template) {
      const db = databaseForOperation(database);
      const replaced = {
        privateObjectKey: template.privateObjectKey,
        originalFileName: template.originalFileName,
        sizeBytes: template.sizeBytes,
        checksum: template.checksum,
        profile: template.profile,
        uploadedBy: template.uploadedBy,
        updatedAt: new Date(template.updatedAt),
      };
      try {
        const [row] = await db.insert(businessTemplates)
          .values({ ...replaced, id: template.id, businessId: template.businessId, createdAt: new Date(template.createdAt) })
          .onConflictDoUpdate({ target: businessTemplates.businessId, set: replaced })
          .returning();
        if (!row) throw new TemplateError(TEMPLATE_ERROR_CODES.TEMPLATE_REPOSITORY_CONFLICT);
        return mapTemplate(row);
      } catch (error) {
        return preserveOrMap(error);
      }
    },
  };
}
