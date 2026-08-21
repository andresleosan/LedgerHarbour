import { describe, expect, it } from "vitest";

import {
  classifyServiceExpirationDryRun,
  SERVICE_EXPIRATION_DRY_RUN_POLICY,
  type ServiceExpirationDryRunRecord,
} from "../../../src/modules/operations/service-expiration-dry-run";

const asOf = new Date("2026-08-21T12:00:00.000Z");

function record(overrides: Partial<ServiceExpirationDryRunRecord> = {}): ServiceExpirationDryRunRecord {
  return {
    id: "business-1",
    status: "active",
    isActive: true,
    serviceExpiresAt: "2026-08-22T23:59:59.000Z",
    ...overrides,
  };
}

function expiresOnUtcDate(date: string): string {
  return `${date}T23:59:59.999Z`;
}

describe("classifyServiceExpirationDryRun", () => {
  it("uses the fixed UTC policy and exact pre-expiration windows", () => {
    const result = classifyServiceExpirationDryRun({
      runId: "run-1",
      asOf,
      records: [
        record({ id: "business-14", serviceExpiresAt: expiresOnUtcDate("2026-09-04") }),
        record({ id: "business-7", serviceExpiresAt: expiresOnUtcDate("2026-08-28") }),
        record({ id: "business-1", serviceExpiresAt: expiresOnUtcDate("2026-08-22") }),
        record({ id: "business-13", serviceExpiresAt: expiresOnUtcDate("2026-09-03") }),
        record({ id: "business-6", serviceExpiresAt: expiresOnUtcDate("2026-08-27") }),
        record({ id: "business-2", serviceExpiresAt: expiresOnUtcDate("2026-08-23") }),
      ],
    });

    expect(result).toMatchObject({
      runId: "run-1",
      asOf: "2026-08-21T12:00:00.000Z",
      timezone: "UTC",
      policy: SERVICE_EXPIRATION_DRY_RUN_POLICY,
      counts: {
        scanned: 6,
        eligible: 6,
        preExpiration14: 1,
        preExpiration7: 1,
        preExpiration1: 1,
        gracePeriod: 0,
        expiredAfterGrace: 0,
        notInWindow: 3,
        excluded: 0,
        errors: 0,
        deduplicationKeysComputed: 6,
        duplicateKeys: 0,
      },
      errorCodes: [],
    });
  });

  it("keeps non-window days out of pre-expiration counts", () => {
    const result = classifyServiceExpirationDryRun({
      runId: "run-2",
      asOf,
      records: [
        record({ serviceExpiresAt: expiresOnUtcDate("2026-09-03") }),
        record({ serviceExpiresAt: expiresOnUtcDate("2026-08-27") }),
        record({ serviceExpiresAt: expiresOnUtcDate("2026-08-23") }),
      ],
    });

    expect(result.counts).toMatchObject({
      preExpiration14: 0,
      preExpiration7: 0,
      preExpiration1: 0,
      notInWindow: 3,
      deduplicationKeysComputed: 3,
      duplicateKeys: 0,
    });
  });

  it("treats the inclusive expiration date as grace day zero through grace day three", () => {
    const result = classifyServiceExpirationDryRun({
      runId: "run-3",
      asOf,
      records: [
        record({ id: "today", serviceExpiresAt: expiresOnUtcDate("2026-08-21") }),
        record({ id: "grace-1", serviceExpiresAt: expiresOnUtcDate("2026-08-20") }),
        record({ id: "grace-2", serviceExpiresAt: expiresOnUtcDate("2026-08-19") }),
        record({ id: "grace-3", serviceExpiresAt: expiresOnUtcDate("2026-08-18") }),
        record({ id: "expired", serviceExpiresAt: expiresOnUtcDate("2026-08-17") }),
      ],
    });

    expect(result.counts).toMatchObject({
      gracePeriod: 4,
      expiredAfterGrace: 1,
      errors: 0,
    });
  });

  it("excludes ineligible or missing-expiration records before classification", () => {
    const result = classifyServiceExpirationDryRun({
      runId: "run-4",
      asOf,
      records: [
        record({ status: "pending" }),
        record({ status: "suspended" }),
        record({ status: "rejected" }),
        record({ isActive: false }),
        record({ serviceExpiresAt: null }),
      ],
    });

    expect(result.counts).toMatchObject({
      scanned: 5,
      eligible: 0,
      excluded: 5,
      errors: 0,
    });
  });

  it("continues after an invalid timestamp without exposing record identifiers", () => {
    const result = classifyServiceExpirationDryRun({
      runId: "run-5",
      asOf,
      records: [
        record({ id: "sensitive-business-id", serviceExpiresAt: "not-a-date" }),
        record({ id: "empty-expiration", serviceExpiresAt: "" }),
        record({ id: "offset-expiration", serviceExpiresAt: "2026-08-28T23:59:59.999+02:00" }),
        record({ id: "excluded-invalid", status: "pending", serviceExpiresAt: "not-a-date" }),
        record({ serviceExpiresAt: expiresOnUtcDate("2026-08-28") }),
      ],
    });

    expect(result.counts).toMatchObject({ eligible: 1, errors: 4, preExpiration7: 1, deduplicationKeysComputed: 1 });
    expect(result.errorCodes).toEqual(["INVALID_SERVICE_EXPIRATION_TIMESTAMP"]);
    expect(JSON.stringify(result)).not.toContain("sensitive-business-id");
  });

  it("counts duplicate diagnostic keys without persisting or exposing them", () => {
    const duplicate = record({ id: "same-business", serviceExpiresAt: expiresOnUtcDate("2026-08-28") });
    const result = classifyServiceExpirationDryRun({ runId: "run-6", asOf, records: [duplicate, duplicate] });

    expect(result.counts).toMatchObject({
      scanned: 2,
      eligible: 2,
      preExpiration7: 2,
      deduplicationKeysComputed: 2,
      duplicateKeys: 1,
    });
    expect(JSON.stringify(result)).not.toContain("same-business");
  });
});
