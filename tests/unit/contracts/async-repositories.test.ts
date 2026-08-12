import { describe, expect, it } from "vitest";

import type { DocumentRepository } from "../../../src/modules/documents/document-service";
import type { InvoiceRepository } from "../../../src/modules/invoices/invoice-service";
import type { CurrencyRepository } from "../../../src/modules/accounting/currency-service";
import type { Job } from "../../../src/modules/jobs/job-service";

const emptyDocumentRepository: DocumentRepository = {
  transaction: async (operation) => operation(),
  create: async (document) => document,
  findById: async () => null,
  getStatus: async () => null,
  setStatus: async () => null,
  listByBusinessId: async () => [],
};

const emptyInvoiceRepository: InvoiceRepository = {
  transaction: async (operation) => operation(),
  create: async (invoice) => invoice,
  findById: async () => null,
  findByDocumentId: async () => null,
  hasCurrencyReference: async () => false,
  update: async (invoice) => invoice,
  updateIfUnchanged: async (invoice) => invoice,
  listByBusinessId: async () => [],
};

const emptyCurrencyRepository: CurrencyRepository = {
  transaction: async (operation) => operation(),
  create: async (currency) => currency,
  update: async (currency) => currency,
  findById: async () => null,
  listByBusinessId: async () => [],
  delete: async () => undefined,
};

const persistentJobRepository: import("../../../src/modules/jobs/job-service").JobRepository = {
  transaction: async (operation) => operation(),
  create: async (job: Job) => job,
  findById: async () => null,
  findByDocumentId: async () => null,
  createOrReuse: async (factory) => factory(),
  claim: async () => null,
  update: async (job: Job) => job,
};

describe("persistent repository contracts", () => {
  it("accept async adapters without memory Maps", () => {
    expect(emptyDocumentRepository).not.toHaveProperty("documents");
    expect(emptyInvoiceRepository).not.toHaveProperty("invoices");
    expect(emptyCurrencyRepository).not.toHaveProperty("currencies");
    expect(persistentJobRepository).not.toHaveProperty("jobs");
  });
});
