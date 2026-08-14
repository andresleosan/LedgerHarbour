import { and, eq } from "drizzle-orm";

import type { Database } from "../../db/client";
import { databaseForOperation, transactionWithDatabase } from "../../db/transaction-scope";
import { currencies } from "../../db/schema";
import {
  CURRENCY_ERROR_CODES,
  CurrencyError,
  type BusinessCurrency,
  type CurrencyRepository,
} from "./currency-service";
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

function mapDatabaseError(error: unknown): CurrencyError | null {
  if (error instanceof CurrencyError) return error;
  const code = driverCode(error);
  if (code === "23503" || code === "23505" || code === "23514") {
    return new CurrencyError(CURRENCY_ERROR_CODES.CURRENCY_REPOSITORY_CONFLICT);
  }
  return null;
}

function preserveOrMap(error: unknown): never {
  const mapped = mapDatabaseError(error);
  if (mapped) throw mapped;
  throw new CurrencyError(CURRENCY_ERROR_CODES.CURRENCY_REPOSITORY_CONFLICT);
}

function mapCurrency(row: typeof currencies.$inferSelect): BusinessCurrency {
  return {
    id: row.id,
    businessId: id<BusinessId>(row.businessId),
    name: row.name,
    symbol: row.symbol,
    isoCode: row.isoCode,
    decimalCount: row.decimalCount,
    isStandard: row.isStandard,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function createRepository(database: Database): CurrencyRepository {
  const repository: CurrencyRepository = {
    async transaction<T>(operation: () => Promise<T>): Promise<T> {
      try {
        return await transactionWithDatabase(database, operation);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async create(currency) {
      const db = databaseForOperation(database);
      try {
        const [row] = await db.insert(currencies).values({
          id: currency.id,
          businessId: currency.businessId,
          name: currency.name,
          symbol: currency.symbol,
          isoCode: currency.isoCode,
          decimalCount: currency.decimalCount,
          isStandard: currency.isStandard,
          isActive: currency.isActive,
          createdAt: new Date(currency.createdAt),
          updatedAt: new Date(currency.updatedAt),
        }).returning();
        if (!row) throw new CurrencyError(CURRENCY_ERROR_CODES.CURRENCY_REPOSITORY_CONFLICT);
        return mapCurrency(row);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async update(currency, businessId) {
      const db = databaseForOperation(database);
      try {
        const [row] = await db.update(currencies).set({
          businessId: currency.businessId,
          name: currency.name,
          symbol: currency.symbol,
          isoCode: currency.isoCode,
          decimalCount: currency.decimalCount,
          isStandard: currency.isStandard,
          isActive: currency.isActive,
          updatedAt: new Date(currency.updatedAt),
        }).where(and(eq(currencies.id, currency.id), eq(currencies.businessId, businessId), eq(currencies.businessId, currency.businessId))).returning();
        if (!row) throw new CurrencyError(CURRENCY_ERROR_CODES.CURRENCY_NOT_FOUND);
        return mapCurrency(row);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async findById(currencyId, businessId) {
      const db = databaseForOperation(database);
      try {
        const [row] = await db.select().from(currencies).where(and(eq(currencies.id, currencyId), eq(currencies.businessId, businessId))).limit(1);
        return row ? mapCurrency(row) : null;
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async listByBusinessId(businessId) {
      const db = databaseForOperation(database);
      try {
        const rows = await db.select().from(currencies).where(eq(currencies.businessId, businessId));
        return rows.map(mapCurrency);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async delete(currencyId, businessId) {
      const db = databaseForOperation(database);
      try {
        await db.delete(currencies).where(and(eq(currencies.id, currencyId), eq(currencies.businessId, businessId)));
      } catch (error) {
        return preserveOrMap(error);
      }
    },
  };

  return repository;
}

export function createPostgresCurrencyRepository(database: Database): CurrencyRepository {
  return createRepository(database);
}
