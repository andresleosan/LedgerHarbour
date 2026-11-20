import { and, asc, eq } from "drizzle-orm";

import type { Database } from "../../db/client";
import { databaseForOperation, transactionWithDatabase } from "../../db/transaction-scope";
import { accountHeadings } from "../../db/schema";
import {
  HEADING_ERROR_CODES,
  HeadingError,
  type AccountHeading,
  type HeadingRepository,
} from "./heading-service";
import { isApplicationError } from "./application-error";
import type { BusinessId } from "../tenancy/types";

function preserveOrMap(error: unknown): never {
  if (isApplicationError(error)) throw error;
  throw new HeadingError(HEADING_ERROR_CODES.HEADING_REPOSITORY_CONFLICT);
}

function mapHeading(row: typeof accountHeadings.$inferSelect): AccountHeading {
  return {
    id: row.id,
    businessId: row.businessId as BusinessId,
    position: row.position,
    templateValue: row.templateValue,
    valueType: row.valueType as AccountHeading["valueType"],
    group: row.headingGroup as AccountHeading["group"],
    sortOrder: row.sortOrder,
    displayName: row.displayName,
    isActive: row.isActive,
    blockedReason: row.blockedReason as AccountHeading["blockedReason"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function columns(heading: AccountHeading) {
  return {
    templateValue: heading.templateValue,
    valueType: heading.valueType,
    headingGroup: heading.group,
    sortOrder: heading.sortOrder,
    displayName: heading.displayName,
    isActive: heading.isActive,
    blockedReason: heading.blockedReason,
    updatedAt: new Date(heading.updatedAt),
  };
}

export function createPostgresHeadingRepository(database: Database): HeadingRepository {
  return {
    async transaction<T>(operation: () => Promise<T>): Promise<T> {
      try {
        return await transactionWithDatabase(database, operation);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async create(heading) {
      const db = databaseForOperation(database);
      try {
        const [row] = await db.insert(accountHeadings).values({
          ...columns(heading),
          id: heading.id,
          businessId: heading.businessId,
          position: heading.position,
          createdAt: new Date(heading.createdAt),
        }).returning();
        if (!row) throw new HeadingError(HEADING_ERROR_CODES.HEADING_REPOSITORY_CONFLICT);
        return mapHeading(row);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async update(heading, businessId) {
      const db = databaseForOperation(database);
      try {
        const [row] = await db.update(accountHeadings).set(columns(heading))
          .where(and(eq(accountHeadings.id, heading.id), eq(accountHeadings.businessId, businessId), eq(accountHeadings.businessId, heading.businessId)))
          .returning();
        if (!row) throw new HeadingError(HEADING_ERROR_CODES.HEADING_NOT_FOUND);
        return mapHeading(row);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async findById(headingId, businessId) {
      const db = databaseForOperation(database);
      try {
        const [row] = await db.select().from(accountHeadings).where(and(eq(accountHeadings.id, headingId), eq(accountHeadings.businessId, businessId))).limit(1);
        return row ? mapHeading(row) : null;
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async listByBusinessId(businessId) {
      const db = databaseForOperation(database);
      try {
        const rows = await db.select().from(accountHeadings).where(eq(accountHeadings.businessId, businessId)).orderBy(asc(accountHeadings.sortOrder), asc(accountHeadings.position));
        return rows.map(mapHeading);
      } catch (error) {
        return preserveOrMap(error);
      }
    },
  };
}
