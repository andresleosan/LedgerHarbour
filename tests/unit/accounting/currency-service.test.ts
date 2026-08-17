import { describe, expect, it } from "vitest";

import {
  CURRENCY_ERROR_CODES,
  createCurrencyRepository,
  deactivateCurrency,
  listCurrencies,
  removeCurrency,
  setCurrency,
  type CurrencyDependencies,
} from "../../../src/modules/accounting/currency-service";
import {
  createInMemoryOnboardingRepository,
} from "../../../src/modules/tenancy/business-service";
import type { UserId } from "../../../src/modules/tenancy/types";
import { createInvoiceRepository } from "../../../src/modules/invoices/invoice-service";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const user = (value: string) => value as UserId;

describe("currency service", () => {
  async function context() {
    const tenancy = createInMemoryOnboardingRepository();
    const currencies = createCurrencyRepository();
    const business = await createApprovedBusiness(tenancy, "Currency Books", user("owner"));
    return {
      business,
      dependencies: { tenancyRepository: tenancy, currencies } satisfies CurrencyDependencies,
    };
  }

  it("creates a standard currency with an uppercase ISO code", async () => {
    const { business, dependencies } = await context();

    await expect(setCurrency({ businessId: business.id, name: " Euro ", symbol: " € ", isoCode: "eur", decimalCount: 2 }, user("owner"), dependencies)).resolves.toMatchObject({
      businessId: business.id,
      name: "Euro",
      symbol: "€",
      isoCode: "EUR",
      decimalCount: 2,
      isActive: true,
    });
  });

  it("does not allow callers to mark a custom currency as standard", async () => {
    const { business, dependencies } = await context();

    await expect(setCurrency({ businessId: business.id, name: "Custom Standard", symbol: "CS", decimalCount: 2, isStandard: true }, user("owner"), dependencies)).rejects.toMatchObject({
      code: CURRENCY_ERROR_CODES.INVALID_CURRENCY,
    });
  });

  it.each([
    { name: "Concurrent Currency", symbol: "CC", isoCode: "CCC" },
    { name: "Concurrent Currency A", symbol: "CA", isoCode: "DUP" },
  ])("enforces currency uniqueness atomically for $name", async ({ name, symbol, isoCode }) => {
    const { business, dependencies } = await context();
    const inputs = [
      { businessId: business.id, name, symbol, isoCode, decimalCount: 2 },
      { businessId: business.id, name: name.includes("A") ? name : "Concurrent Currency B", symbol: `${symbol}2`, isoCode, decimalCount: 2 },
    ];

    const results = await Promise.allSettled(inputs.map((input) => setCurrency(input, user("owner"), dependencies)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const storedCurrencies = await dependencies.currencies.listByBusinessId(business.id);
    expect(storedCurrencies.filter((currency) => currency.name === name || currency.isoCode === isoCode)).toHaveLength(1);
  });

  it.each([
    { decimalCount: -1 },
    { decimalCount: 7 },
  ])("rejects decimal counts outside 0..6", async ({ decimalCount }) => {
    const { business, dependencies } = await context();

    await expect(setCurrency({ businessId: business.id, name: "Cash", symbol: "$", decimalCount }, user("owner"), dependencies)).rejects.toMatchObject({
      code: CURRENCY_ERROR_CODES.INVALID_CURRENCY,
    });
  });

  it("rejects an invalid business identifier at the service boundary", async () => {
    const { dependencies } = await context();

    await expect(setCurrency({ businessId: "   " as UserId & { readonly __brand: "BusinessId" }, name: "Cash", symbol: "$", decimalCount: 2 }, user("owner"), dependencies)).rejects.toMatchObject({
      code: CURRENCY_ERROR_CODES.INVALID_CURRENCY,
    });
  });

  it("does not allow a currency ID from another business to be deactivated", async () => {
    const first = await context();
    const second = await context();
    const currency = await setCurrency({ businessId: first.business.id, name: "Dollar", symbol: "$", isoCode: "usd", decimalCount: 2 }, user("owner"), first.dependencies);

    await expect(deactivateCurrency(second.business.id, currency.id, user("owner"), second.dependencies)).rejects.toMatchObject({
      code: CURRENCY_ERROR_CODES.CURRENCY_NOT_FOUND,
    });
  });

  it("protects an invoice-referenced currency from removal", async () => {
    const { business, dependencies } = await context();
    const currency = await setCurrency({ businessId: business.id, name: "Dollar", symbol: "$", isoCode: "usd", decimalCount: 2 }, user("owner"), dependencies);
    const invoices = createInvoiceRepository();
    await invoices.create({ id: "invoice" as never, businessId: business.id, documentId: "document" as never, currencyReference: currency.id } as never);

    await expect(removeCurrency(business.id, currency.id, user("owner"), { ...dependencies, invoices })).rejects.toMatchObject({ code: CURRENCY_ERROR_CODES.CURRENCY_REFERENCED });
  });

  it("keeps GBP, EUR, and USD available as standard business options", async () => {
    const { business, dependencies } = await context();

    await expect(listCurrencies(business.id, user("owner"), dependencies)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ isoCode: "GBP", isStandard: true }),
      expect.objectContaining({ isoCode: "EUR", isStandard: true }),
      expect.objectContaining({ isoCode: "USD", isStandard: true }),
    ]));
  });

  it("lists currencies through an async repository query without a currencies map", async () => {
    const { business, dependencies } = await context();
    const base = dependencies.currencies;
    const portable = {
      transaction: base.transaction.bind(base),
      create: base.create.bind(base),
      update: base.update.bind(base),
      findById: base.findById.bind(base),
      listByBusinessId: async (businessId: typeof business.id) => {
        const result: Array<NonNullable<Awaited<ReturnType<typeof base.findById>>>> = [];
        for (const currency of [await base.findById(`currency-${businessId}-GBP`, businessId), await base.findById(`currency-${businessId}-EUR`, businessId), await base.findById(`currency-${businessId}-USD`, businessId)]) {
          if (currency) result.push(currency);
        }
        return result;
      },
    } as never;

    await expect(listCurrencies(business.id, user("owner"), { ...dependencies, currencies: portable }))
      .resolves.toEqual(expect.arrayContaining([expect.objectContaining({ isoCode: "GBP" })]));
  });
});
