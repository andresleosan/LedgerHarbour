import { describe, expect, it } from "vitest";

import { createTestDatabase } from "../../../src/db/test-database";
import type { AuthIdentity } from "../../../src/modules/auth/auth-provider";
import {
  CURRENCY_ERROR_CODES,
  CurrencyError,
  type BusinessCurrency,
} from "../../../src/modules/accounting/currency-service";
import { createPostgresCurrencyRepository } from "../../../src/modules/accounting/postgres-currency-repository";
import { createPostgresOnboardingRepository } from "../../../src/modules/tenancy/postgres-tenancy-repository";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const identity: AuthIdentity = {
  providerUserId: "currency-repository-owner",
  email: "currency-repository-owner@example.com",
  displayName: "Currency Repository Owner",
  emailVerified: true,
};

function currency(businessId: BusinessCurrency["businessId"], currencyId = "currency-eur"): BusinessCurrency {
  return {
    id: currencyId,
    businessId,
    name: "Euro",
    symbol: "EUR",
    isoCode: "EUR",
    decimalCount: 2,
    isStandard: false,
    isActive: true,
    createdAt: "2026-08-13T12:00:00.000Z",
    updatedAt: "2026-08-13T12:00:00.000Z",
  };
}

describe("PostgreSQL currency repository contract", () => {
  it("persists, reads, lists, updates, and deletes currencies with ISO dates", async () => {
    const { db, close } = await createTestDatabase();

    try {
      const tenancyRepository = createPostgresOnboardingRepository(db);
      const business = await createApprovedBusiness(tenancyRepository, "Currency Repository Books", identity);
      const currencyRepository = createPostgresCurrencyRepository(db);
      const expected = currency(business.id);

      const created = await currencyRepository.create(expected);
      expect(created).toEqual(expected);
      await expect(currencyRepository.findById(created.id, business.id)).resolves.toEqual(expected);
      await expect(currencyRepository.listByBusinessId(business.id)).resolves.toEqual([expected]);

      const updated = { ...expected, name: "Euro Updated", updatedAt: "2026-08-13T12:01:00.000Z" };
      await expect(currencyRepository.update(updated, business.id)).resolves.toEqual(updated);
      await expect(currencyRepository.findById(expected.id, business.id)).resolves.toEqual(updated);

      await currencyRepository.delete(expected.id, business.id);
      await expect(currencyRepository.findById(expected.id, business.id)).resolves.toBeNull();
    } finally {
      await close();
    }
  }, 30_000);

  it("uses a real transaction and maps rollback failures to a public conflict", async () => {
    const { db, close } = await createTestDatabase();

    try {
      const tenancyRepository = createPostgresOnboardingRepository(db);
      const business = await createApprovedBusiness(tenancyRepository, "Currency Transaction Books", identity);
      const currencyRepository = createPostgresCurrencyRepository(db);
      const candidate = currency(business.id);

      await expect(currencyRepository.transaction(async () => {
        await currencyRepository.create(candidate);
        throw new Error("driver details must not escape");
      })).rejects.toMatchObject({
        code: CURRENCY_ERROR_CODES.CURRENCY_REPOSITORY_CONFLICT,
        message: "The currency changed elsewhere.",
      });

      await expect(currencyRepository.findById(candidate.id, business.id)).resolves.toBeNull();
    } finally {
      await close();
    }
  }, 30_000);

  it("maps database conflicts without exposing driver details", async () => {
    const { db, close } = await createTestDatabase();

    try {
      const tenancyRepository = createPostgresOnboardingRepository(db);
      const business = await createApprovedBusiness(tenancyRepository, "Currency Conflict Books", identity);
      const currencyRepository = createPostgresCurrencyRepository(db);
      const candidate = currency(business.id);

      await currencyRepository.create(candidate);

      const error = await currencyRepository.create(candidate).catch((value: unknown) => value);
      expect(error).toBeInstanceOf(CurrencyError);
      expect(error).toMatchObject({
        code: CURRENCY_ERROR_CODES.CURRENCY_REPOSITORY_CONFLICT,
        message: "The currency changed elsewhere.",
      });
      expect(error).not.toHaveProperty("detail");
      expect(error).not.toHaveProperty("constraint");
    } finally {
      await close();
    }
  }, 30_000);

  it("scopes ID operations to the currency business", async () => {
    const { db, close } = await createTestDatabase();

    try {
      const tenancyRepository = createPostgresOnboardingRepository(db);
      const firstBusiness = await createApprovedBusiness(tenancyRepository, "First Currency Books", identity);
      const secondBusiness = await createApprovedBusiness(tenancyRepository, "Second Currency Books", identity);
      const currencyRepository = createPostgresCurrencyRepository(db);
      const expected = currency(firstBusiness.id, "currency-cross-tenant");

      await currencyRepository.create(expected);

      await expect(currencyRepository.findById(expected.id, secondBusiness.id)).resolves.toBeNull();
      await expect(currencyRepository.update({ ...expected, name: "Hijacked" }, secondBusiness.id)).rejects.toMatchObject({
        code: CURRENCY_ERROR_CODES.CURRENCY_NOT_FOUND,
      });
      await expect(currencyRepository.findById(expected.id, firstBusiness.id)).resolves.toEqual(expected);

      await currencyRepository.delete(expected.id, secondBusiness.id);
      await expect(currencyRepository.findById(expected.id, firstBusiness.id)).resolves.toEqual(expected);
    } finally {
      await close();
    }
  }, 30_000);
});
