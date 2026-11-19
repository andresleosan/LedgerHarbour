import { and, asc, eq, isNull } from "drizzle-orm";

import type { Database } from "../../db/client";
import { databaseForOperation, transactionWithDatabase } from "../../db/transaction-scope";
import { financialYears, moneyAccountOpenings, moneyAccounts, movements } from "../../db/schema";
import {
  MONEY_ERROR_CODES,
  MoneyError,
  type FinancialYear,
  type MoneyAccount,
  type MoneyRepository,
  type Movement,
} from "./money-repository";
import type { BusinessId, UserId } from "../tenancy/types";

function preserveOrMap(error: unknown): never {
  if (error instanceof MoneyError) throw error;
  throw new MoneyError(MONEY_ERROR_CODES.MONEY_REPOSITORY_CONFLICT);
}

function mapYear(row: typeof financialYears.$inferSelect): FinancialYear {
  return {
    id: row.id,
    businessId: row.businessId as BusinessId,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status as FinancialYear["status"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapAccount(row: typeof moneyAccounts.$inferSelect): MoneyAccount {
  return {
    id: row.id,
    businessId: row.businessId as BusinessId,
    name: row.name,
    kind: row.kind as MoneyAccount["kind"],
    sheetName: row.sheetName,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapMovement(row: typeof movements.$inferSelect): Movement {
  return {
    id: row.id,
    businessId: row.businessId as BusinessId,
    financialYearId: row.financialYearId,
    moneyAccountId: row.moneyAccountId,
    movementDate: row.movementDate,
    narrative: row.narrative,
    headingId: row.headingId,
    amount: row.amount,
    origin: row.origin as Movement["origin"],
    sourceInvoiceId: row.sourceInvoiceId,
    sourceRef: row.sourceRef,
    transferGroupId: row.transferGroupId,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdBy: row.createdBy as UserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function movementColumns(movement: Movement) {
  return {
    financialYearId: movement.financialYearId,
    moneyAccountId: movement.moneyAccountId,
    movementDate: movement.movementDate,
    narrative: movement.narrative,
    headingId: movement.headingId,
    amount: movement.amount,
    origin: movement.origin,
    sourceInvoiceId: movement.sourceInvoiceId,
    sourceRef: movement.sourceRef,
    transferGroupId: movement.transferGroupId,
    deletedAt: movement.deletedAt === null ? null : new Date(movement.deletedAt),
    updatedAt: new Date(movement.updatedAt),
  };
}

/** Wraps each repository call: domain errors pass through, anything else becomes a conflict. */
function guarded<A extends unknown[], R>(operation: (db: Database, ...args: A) => Promise<R>, database: Database) {
  return async (...args: A): Promise<R> => {
    try {
      return await operation(databaseForOperation(database), ...args);
    } catch (error) {
      return preserveOrMap(error);
    }
  };
}

function one<T>(rows: T[], notFound: MoneyError["code"] = MONEY_ERROR_CODES.MONEY_REPOSITORY_CONFLICT): T {
  if (!rows[0]) throw new MoneyError(notFound);
  return rows[0];
}

const liveOrder = [asc(movements.movementDate), asc(movements.createdSeq)];

export function createPostgresMoneyRepository(database: Database): MoneyRepository {
  return {
    async transaction<T>(operation: () => Promise<T>): Promise<T> {
      try {
        return await transactionWithDatabase(database, operation);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    createYear: guarded(async (db, year: FinancialYear) => mapYear(one(await db.insert(financialYears).values({
      ...year,
      createdAt: new Date(year.createdAt),
      updatedAt: new Date(year.updatedAt),
    }).returning())), database),

    updateYear: guarded(async (db, year: FinancialYear, businessId: BusinessId) => mapYear(one(await db.update(financialYears)
      .set({ startDate: year.startDate, endDate: year.endDate, status: year.status, updatedAt: new Date(year.updatedAt) })
      .where(and(eq(financialYears.id, year.id), eq(financialYears.businessId, businessId), eq(financialYears.businessId, year.businessId)))
      .returning(), MONEY_ERROR_CODES.FINANCIAL_YEAR_NOT_FOUND)), database),

    findYear: guarded(async (db, id: string, businessId: BusinessId) => {
      const [row] = await db.select().from(financialYears).where(and(eq(financialYears.id, id), eq(financialYears.businessId, businessId))).limit(1);
      return row ? mapYear(row) : null;
    }, database),

    listYears: guarded(async (db, businessId: BusinessId) => (await db.select().from(financialYears)
      .where(eq(financialYears.businessId, businessId)).orderBy(asc(financialYears.startDate))).map(mapYear), database),

    createAccount: guarded(async (db, account: MoneyAccount) => mapAccount(one(await db.insert(moneyAccounts).values({
      ...account,
      createdAt: new Date(account.createdAt),
      updatedAt: new Date(account.updatedAt),
    }).returning())), database),

    updateAccount: guarded(async (db, account: MoneyAccount, businessId: BusinessId) => mapAccount(one(await db.update(moneyAccounts)
      .set({ name: account.name, isActive: account.isActive, updatedAt: new Date(account.updatedAt) })
      .where(and(eq(moneyAccounts.id, account.id), eq(moneyAccounts.businessId, businessId), eq(moneyAccounts.businessId, account.businessId)))
      .returning(), MONEY_ERROR_CODES.MONEY_ACCOUNT_NOT_FOUND)), database),

    findAccount: guarded(async (db, id: string, businessId: BusinessId) => {
      const [row] = await db.select().from(moneyAccounts).where(and(eq(moneyAccounts.id, id), eq(moneyAccounts.businessId, businessId))).limit(1);
      return row ? mapAccount(row) : null;
    }, database),

    listAccounts: guarded(async (db, businessId: BusinessId) => (await db.select().from(moneyAccounts)
      .where(eq(moneyAccounts.businessId, businessId)).orderBy(asc(moneyAccounts.name), asc(moneyAccounts.id))).map(mapAccount), database),

    setOpening: guarded(async (db, businessId: BusinessId, accountId: string, yearId: string, amount: string) => {
      await db.insert(moneyAccountOpenings).values({ businessId, moneyAccountId: accountId, financialYearId: yearId, openingBalance: amount })
        .onConflictDoUpdate({ target: [moneyAccountOpenings.businessId, moneyAccountOpenings.moneyAccountId, moneyAccountOpenings.financialYearId], set: { openingBalance: amount } });
    }, database),

    listOpenings: guarded(async (db, businessId: BusinessId, yearId: string) => new Map((await db.select().from(moneyAccountOpenings)
      .where(and(eq(moneyAccountOpenings.businessId, businessId), eq(moneyAccountOpenings.financialYearId, yearId))))
      .map((row) => [row.moneyAccountId, row.openingBalance])), database),

    createMovement: guarded(async (db, movement: Movement) => mapMovement(one(await db.insert(movements).values({
      ...movementColumns(movement),
      id: movement.id,
      businessId: movement.businessId,
      createdBy: movement.createdBy,
      createdAt: new Date(movement.createdAt),
    }).returning())), database),

    updateMovement: guarded(async (db, movement: Movement, businessId: BusinessId) => mapMovement(one(await db.update(movements)
      .set(movementColumns(movement))
      .where(and(eq(movements.id, movement.id), eq(movements.businessId, businessId), eq(movements.businessId, movement.businessId)))
      .returning(), MONEY_ERROR_CODES.MOVEMENT_NOT_FOUND)), database),

    findMovement: guarded(async (db, id: string, businessId: BusinessId) => {
      const [row] = await db.select().from(movements).where(and(eq(movements.id, id), eq(movements.businessId, businessId))).limit(1);
      return row ? mapMovement(row) : null;
    }, database),

    listMovements: guarded(async (db, businessId: BusinessId, yearId: string, accountId?: string) => (await db.select().from(movements)
      .where(and(
        eq(movements.businessId, businessId),
        eq(movements.financialYearId, yearId),
        accountId === undefined ? undefined : eq(movements.moneyAccountId, accountId),
        isNull(movements.deletedAt),
      ))
      .orderBy(...liveOrder)).map(mapMovement), database),

    listInvoiceMovements: guarded(async (db, businessId: BusinessId, invoiceId: string) => (await db.select().from(movements)
      .where(and(eq(movements.businessId, businessId), eq(movements.sourceInvoiceId, invoiceId), isNull(movements.deletedAt)))
      .orderBy(asc(movements.createdSeq))).map(mapMovement), database),
  };
}
