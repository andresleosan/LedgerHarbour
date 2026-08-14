import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appRoot = new URL("../../../src/app/", import.meta.url);

const source = (relativePath: string) => readFileSync(new URL(relativePath, appRoot), "utf8");

describe("server-side identity boundary", () => {
  it("passes AuthIdentity to portfolio and dashboard services", () => {
    for (const path of ["(app)/layout.tsx", "(app)/portfolio/page.tsx"]) {
      const page = source(path);
      expect(page).toContain("getPersistenceContext");
      expect(page).toContain("listUserBusinesses(identity, {");
      expect(page).toContain("tenancyRepository: persistence.tenancyRepository");
      expect(page).toContain("documentRepository: persistence.documentRepository");
      expect(page).toContain("invoiceRepository: persistence.invoiceRepository");
    }

    const dashboard = source("(app)/business/[businessId]/page.tsx");
    expect(dashboard).toContain("getPersistenceContext");
    expect(dashboard).toContain("getBusinessDashboard(businessId as BusinessId, identity, {");
    expect(dashboard).toContain("tenancyRepository: persistence.tenancyRepository");
    expect(dashboard).toContain("documentRepository: persistence.documentRepository");
    expect(dashboard).toContain("invoiceRepository: persistence.invoiceRepository");
    expect(dashboard).toContain("error.code === AUTHORIZATION_ERROR_CODES.BUSINESS_ACCESS_DENIED");
    expect(dashboard).toContain("error.code === LIFECYCLE_ERROR_CODES.BUSINESS_NOT_FOUND");
    expect(dashboard).toContain("error.code === LIFECYCLE_ERROR_CODES.INACTIVE_BUSINESS");
  });

  it("passes AuthIdentity to the invoice list service", () => {
    const page = source("(app)/business/[businessId]/invoices/page.tsx");
    expect(page).toContain("const persistence = getPersistenceContext()");
    expect(page).toContain("listInvoices(businessId as BusinessId, identity, {");
    expect(page).toContain("tenancyRepository: persistence.tenancyRepository");
    expect(page).toContain("documentRepository: persistence.documentRepository");
    expect(page).toContain("invoices: persistence.invoiceRepository");
  });

  it("does not silently turn invoice repository failures into an empty list", () => {
    const page = source("(app)/business/[businessId]/invoices/page.tsx");
    expect(page).toContain("invoices = await listInvoices");
    expect(page).not.toContain("catch { invoices = []; }");
    expect(page).toContain("instanceof BusinessLifecycleError");
    expect(page).toContain("instanceof AuthorizationError");
    expect(page).toContain("error.code === AUTHORIZATION_ERROR_CODES.BUSINESS_ACCESS_DENIED");
    expect(page).toContain("listError");
    expect(page).toContain("copy.loadError");
  });

  it("does not cast providerUserId to a local UserId in server pages", () => {
    for (const path of [
      "(app)/layout.tsx",
      "(app)/portfolio/page.tsx",
      "(app)/business/[businessId]/page.tsx",
      "(app)/business/[businessId]/invoices/page.tsx",
    ]) {
      expect(source(path)).not.toContain("providerUserId as UserId");
    }
  });
});
