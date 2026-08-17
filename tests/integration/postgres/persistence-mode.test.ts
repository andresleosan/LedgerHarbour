import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";

const poolEnds: Array<ReturnType<typeof vi.fn>> = [];

vi.mock("pg", () => ({
  Pool: class MockPool {
    readonly end = vi.fn(async () => {});

    constructor() {
      poolEnds.push(this.end);
    }
  },
}));

beforeEach(() => poolEnds.splice(0));

import { createTestDatabase } from "../../../src/db/test-database";
import { users } from "../../../src/db/schema";
import { defaultOnboardingRepository } from "../../../src/modules/tenancy/business-service";
import { resolveDefaultDocumentRepository, resolveDefaultInvoiceRepository } from "../../../src/modules/invoices/invoice-service";
import { resolveDefaultCurrencyRepository, setCurrency } from "../../../src/modules/accounting/currency-service";
import { resolveDefaultJobRepository } from "../../../src/modules/jobs/job-service";
import { resolveDefaultStorage } from "../../../src/modules/invoices/invoice-service";
import { listUserBusinesses } from "../../../src/modules/tenancy/portfolio-service";
import {
  PersistenceConfigurationError,
  createPersistenceContext,
  getPersistenceContext,
  resetPersistenceContextForTests,
} from "../../../src/modules/persistence/repository-factory";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

function expectSafeConfigurationError(action: () => void, expectedMessage: string) {
  let caught: unknown;

  try {
    action();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(PersistenceConfigurationError);
  if (!(caught instanceof Error)) return;

  expect(caught.message).toBe(expectedMessage);
  expect(caught.message).not.toMatch(/\bSQL\b/i);
  expect(caught.message).not.toMatch(/\b(?:select|insert|update|delete|drop|alter|create|truncate)\b/i);
  expect(caught.message).not.toMatch(/(?:postgres(?:ql)?:\/\/|https?:\/\/)/i);
  expect(caught.message).not.toMatch(/(?:secret-user|secret-password|secret\.example|password|credential|token)/i);
}

afterEach(async () => {
  delete process.env.PERSISTENCE_MODE;
  delete process.env.DATABASE_URL;
  await resetPersistenceContextForTests();
});

describe("persistence mode factory", () => {
  it("reuses the existing in-memory repositories and local storage", () => {
    const context = createPersistenceContext({ mode: "memory" });

    expect(context.mode).toBe("memory");
    expect(context.tenancyRepository).toBe(defaultOnboardingRepository);
    expect(context.documentRepository).toBe(resolveDefaultDocumentRepository());
    expect(context.invoiceRepository).toBe(resolveDefaultInvoiceRepository());
    expect(context.jobRepository).toBe(resolveDefaultJobRepository());
    expect(context.currencyRepository).toBe(resolveDefaultCurrencyRepository());
    expect(context.storage).toBe(resolveDefaultStorage());
    expect(context.database).toBeUndefined();
  });

  it("creates every PostgreSQL adapter from the injected database", async () => {
    const { db, close } = await createTestDatabase();

    try {
      const context = createPersistenceContext({ mode: "postgres", database: db });

      expect(context.mode).toBe("postgres");
      expect(context.database).toBe(db);
      expect(context.tenancyRepository).not.toBe(defaultOnboardingRepository);
      expect(context.documentRepository).not.toBe(resolveDefaultDocumentRepository());
      expect(context.invoiceRepository).not.toBe(resolveDefaultInvoiceRepository());
      expect(context.jobRepository).not.toBe(resolveDefaultJobRepository());
      expect(context.currencyRepository).not.toBe(resolveDefaultCurrencyRepository());
      expect(context.storage).toBe(resolveDefaultStorage());

      await context.close();
      await expect(db.select().from(users).limit(1)).resolves.toEqual([]);
    } finally {
      await close();
    }
  }, 30_000);

  it("does not close an injected database when the context closes", async () => {
    const { db, close } = await createTestDatabase();

    try {
      const context = createPersistenceContext({ mode: "postgres", database: db });
      await context.close();
      await expect(db.select().from(users).limit(1)).resolves.toEqual([]);
    } finally {
      await close();
    }
  }, 30_000);

  it("rejects unknown modes without exposing configuration values", () => {
    expectSafeConfigurationError(
      () => createPersistenceContext({
        mode: "invalid",
        databaseUrl: "postgresql://secret-user:secret-password@secret.example:5432/ledgerharbour",
      }),
      "Unsupported persistence mode.",
    );
  });

  it("fails closed for PostgreSQL without an injected database or URL", () => {
    delete process.env.DATABASE_URL;
    expectSafeConfigurationError(
      () => createPersistenceContext({ mode: "postgres" }),
      "DATABASE_URL is required for postgres persistence.",
    );
  });

  it("fails closed for the runtime selector without DATABASE_URL", () => {
    process.env.PERSISTENCE_MODE = "postgres";
    delete process.env.DATABASE_URL;

    expectSafeConfigurationError(
      () => getPersistenceContext(),
      "DATABASE_URL is required for postgres persistence.",
    );
  });

  it("caches runtime contexts separately by mode and URL", async () => {
    try {
      process.env.PERSISTENCE_MODE = "memory";
      delete process.env.DATABASE_URL;
      const memory = getPersistenceContext();

      process.env.PERSISTENCE_MODE = "postgres";
      process.env.DATABASE_URL = "postgresql://localhost:5432/ledgerharbour-test";
      const first = getPersistenceContext();
      const firstAgain = getPersistenceContext();

      process.env.DATABASE_URL = "postgresql://localhost:5432/ledgerharbour-other";
      const second = getPersistenceContext();
      const secondAgain = getPersistenceContext();

      expect(firstAgain).toBe(first);
      expect(secondAgain).toBe(second);
      expect(second).not.toBe(first);
      expect(first).not.toBe(memory);
      expect(second).not.toBe(memory);
      expect(first.mode).toBe("postgres");
      expect(second.mode).toBe("postgres");
      expect(memory.mode).toBe("memory");
    } finally {
      await resetPersistenceContextForTests();
    }
  });

  it("closes and invalidates the previous runtime context when DATABASE_URL changes", async () => {
    try {
      process.env.PERSISTENCE_MODE = "postgres";
      process.env.DATABASE_URL = "postgresql://localhost:5432/ledgerharbour-first";
      const first = getPersistenceContext();

      process.env.DATABASE_URL = "postgresql://localhost:5432/ledgerharbour-second";
      const second = getPersistenceContext();

      expect(second).not.toBe(first);
      expect(poolEnds).toHaveLength(2);
      expect(poolEnds[0]).toHaveBeenCalledOnce();

      process.env.DATABASE_URL = "postgresql://localhost:5432/ledgerharbour-first";
      const firstAgain = getPersistenceContext();
      expect(firstAgain).not.toBe(first);
      expect(poolEnds[1]).toHaveBeenCalledOnce();
    } finally {
      await resetPersistenceContextForTests();
    }
  });

  it("keeps business and currency operations on the same PostgreSQL context", async () => {
    const { db, close } = await createTestDatabase();
    const identity = {
      providerUserId: "persistence-wiring-owner",
      email: "persistence-wiring-owner@example.com",
      displayName: "Persistence Wiring Owner",
      emailVerified: true,
    };

    try {
      const context = createPersistenceContext({ mode: "postgres", database: db });
      const business = await createApprovedBusiness(context.tenancyRepository, "Postgres Wiring Books", identity);
      const currency = await setCurrency(
        {
          businessId: business.id,
          name: "Euro",
          symbol: "EUR",
          decimalCount: 2,
          isoCode: "EUR",
        },
        identity,
        {
          tenancyRepository: context.tenancyRepository,
          currencies: context.currencyRepository,
          invoices: context.invoiceRepository,
        },
      );

      expect(await context.tenancyRepository.findBusiness(business.id)).toEqual(business);
      expect(await context.currencyRepository.findById(currency.id, business.id)).toEqual(currency);
      expect(await defaultOnboardingRepository.findBusiness(business.id)).toBeNull();
      expect(await resolveDefaultCurrencyRepository().findById(currency.id, business.id)).toBeNull();
    } finally {
      await close();
    }
  }, 30_000);

  it("isolates memberships for two users in separate businesses", async () => {
    const { db, close } = await createTestDatabase();
    const context = createPersistenceContext({ mode: "postgres", database: db });
    const ownerA = {
      providerUserId: "persistence-isolation-owner-a",
      email: "persistence-isolation-owner-a@example.com",
      displayName: "Persistence Isolation Owner A",
      emailVerified: true,
    };
    const ownerB = {
      providerUserId: "persistence-isolation-owner-b",
      email: "persistence-isolation-owner-b@example.com",
      displayName: "Persistence Isolation Owner B",
      emailVerified: true,
    };

    try {
      const businessA = await createApprovedBusiness(context.tenancyRepository, "Isolation Books A", ownerA);
      const businessB = await createApprovedBusiness(context.tenancyRepository, "Isolation Books B", ownerB);

      await expect(listUserBusinesses(ownerA, { tenancyRepository: context.tenancyRepository })).resolves.toEqual([
        { id: businessA.id, name: businessA.name, isActive: true, role: "owner_admin" },
      ]);
      await expect(listUserBusinesses(ownerB, { tenancyRepository: context.tenancyRepository })).resolves.toEqual([
        { id: businessB.id, name: businessB.name, isActive: true, role: "owner_admin" },
      ]);
    } finally {
      await close();
    }
  }, 30_000);

  it("wires the businesses route to the request persistence context", async () => {
    const { db, close } = await createTestDatabase();
    const context = createPersistenceContext({ mode: "postgres", database: db });
    const identity = {
      providerUserId: "persistence-route-owner",
      email: "persistence-route-owner@example.com",
      displayName: "Persistence Route Owner",
      emailVerified: true,
    };
    let routeContext = context;

    try {
      vi.resetModules();
      vi.doMock("../../../src/modules/persistence/repository-factory", async () => {
        const actual = await vi.importActual<typeof import("../../../src/modules/persistence/repository-factory")>(
          "../../../src/modules/persistence/repository-factory",
        );
        return { ...actual, getPersistenceContext: () => routeContext };
      });
      const { POST } = await import("../../../src/app/api/businesses/route");

      await (await import("../../../src/modules/auth/session")).setCurrentIdentity(identity);
      const response = await POST(new Request("http://localhost/api/businesses", {
        method: "POST",
        body: JSON.stringify({ name: "Postgres Route Books" }),
        headers: { "content-type": "application/json" },
      }));

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(await context.tenancyRepository.findBusiness(body.id)).not.toBeNull();
      expect(await defaultOnboardingRepository.findBusiness(body.id)).toBeNull();
    } finally {
      routeContext = context;
      vi.doUnmock("../../../src/modules/persistence/repository-factory");
      vi.resetModules();
      await close();
    }
  }, 30_000);
});
