import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appRoot = new URL("../../../src/app/", import.meta.url);

const source = (relativePath: string) => readFileSync(new URL(relativePath, appRoot), "utf8");

describe("server-side identity boundary", () => {
  it("passes AuthIdentity to portfolio and dashboard services", () => {
    expect(source("(app)/layout.tsx")).toContain("listUserBusinesses(identity)");
    expect(source("(app)/portfolio/page.tsx")).toContain("listUserBusinesses(identity)");
    expect(source("(app)/business/[businessId]/page.tsx")).toContain("getBusinessDashboard(businessId as BusinessId, identity)");
  });

  it("passes AuthIdentity to the invoice list service", () => {
    expect(source("(app)/business/[businessId]/invoices/page.tsx")).toContain("listInvoices(businessId as BusinessId, identity)");
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
