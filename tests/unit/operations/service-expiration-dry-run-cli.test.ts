import { describe, expect, it, vi } from "vitest";

import {
  executeServiceExpirationDryRun,
  parseServiceExpirationDryRunArgs,
  type ServiceExpirationDryRunCliDependencies,
} from "../../../src/modules/operations/service-expiration-dry-run";

function dependencies(overrides: Partial<ServiceExpirationDryRunCliDependencies> = {}): ServiceExpirationDryRunCliDependencies {
  return {
    openRepository: vi.fn(async () => ({
      repository: {
        listBusinesses: vi.fn(async () => []),
      },
      close: vi.fn(async () => undefined),
    })),
    now: () => new Date("2026-08-21T12:00:00.000Z"),
    createRunId: () => "run-cli-1",
    ...overrides,
  };
}

describe("service expiration dry-run CLI", () => {
  it("parses the optional ISO as-of argument", () => {
    expect(parseServiceExpirationDryRunArgs(["--as-of=2026-08-21T00:00:00Z"])).toEqual({
      asOf: new Date("2026-08-21T00:00:00.000Z"),
    });
  });

  it("rejects invalid and unknown arguments", () => {
    expect(parseServiceExpirationDryRunArgs(["--as-of=not-a-date"])).toEqual({ error: "Invalid --as-of value" });
    expect(parseServiceExpirationDryRunArgs(["--as-of=2026-08-21"])).toEqual({ error: "Invalid --as-of value" });
    expect(parseServiceExpirationDryRunArgs(["--as-of=2026-08-21T00:00:00+02:00"])).toEqual({ error: "Invalid --as-of value" });
    expect(parseServiceExpirationDryRunArgs(["--as-of=2026-02-30T00:00:00Z"])).toEqual({ error: "Invalid --as-of value" });
    expect(parseServiceExpirationDryRunArgs(["--unknown=private-value"])).toEqual({ error: "Unknown argument" });
  });

  it("rejects missing database configuration before opening a repository", async () => {
    const openRepository = vi.fn();
    const result = await executeServiceExpirationDryRun([], {}, dependencies({ openRepository }));

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "DATABASE_URL is required for service expiration dry-run",
    });
    expect(openRepository).not.toHaveBeenCalled();
  });

  it("reports invalid arguments on stderr before opening a repository", async () => {
    const openRepository = vi.fn();
    const result = await executeServiceExpirationDryRun(["--as-of=2026-08-21"], { DATABASE_URL: "unused" }, dependencies({ openRepository }));

    expect(result).toEqual({ exitCode: 1, stdout: "", stderr: "Invalid --as-of value" });
    expect(openRepository).not.toHaveBeenCalled();
  });

  it("rejects an invalid database URL before opening a repository", async () => {
    const openRepository = vi.fn();
    const result = await executeServiceExpirationDryRun([], { DATABASE_URL: "https://not-postgres" }, dependencies({ openRepository }));

    expect(result).toEqual({ exitCode: 1, stdout: "", stderr: "Invalid DATABASE_URL for service expiration dry-run" });
    expect(openRepository).not.toHaveBeenCalled();
  });

  it("emits one aggregate JSON document using the explicit as-of value", async () => {
    const close = vi.fn(async () => undefined);
    const result = await executeServiceExpirationDryRun(
      ["--as-of=2026-08-21T00:00:00Z"],
      { DATABASE_URL: "postgres://safe-test-only" },
      dependencies({
        openRepository: vi.fn(async () => ({
          repository: { listBusinesses: vi.fn(async () => []) },
          close,
        })),
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.split("\n")).toHaveLength(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      runId: "run-cli-1",
      asOf: "2026-08-21T00:00:00.000Z",
      counts: { scanned: 0 },
    });
    expect(close).toHaveBeenCalledOnce();
    expect(result.stdout).not.toContain("postgres://");
  });

  it("uses the injected clock when no as-of argument is provided", async () => {
    const result = await executeServiceExpirationDryRun(
      [],
      { DATABASE_URL: "postgres://safe-test-only" },
      dependencies(),
    );

    expect(JSON.parse(result.stdout).asOf).toBe("2026-08-21T12:00:00.000Z");
  });

  it("returns the aggregate with exit code one after record errors", async () => {
    const result = await executeServiceExpirationDryRun(
      [],
      { DATABASE_URL: "postgres://safe-test-only" },
      dependencies({
        openRepository: vi.fn(async () => ({
          repository: {
            listBusinesses: vi.fn(async () => [{
              id: "business-with-invalid-date",
              status: "active",
              isActive: true,
              serviceExpiresAt: "not-a-date",
            } as never]),
          },
          close: vi.fn(async () => undefined),
        })),
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).counts.errors).toBe(1);
    expect(result.stderr).toBe("");
  });

  it("sanitizes repository failures and closes the repository", async () => {
    const close = vi.fn(async () => undefined);
    const result = await executeServiceExpirationDryRun(
      [],
      { DATABASE_URL: "postgres://secret-value" },
      dependencies({
        openRepository: vi.fn(async () => ({
          repository: {
            listBusinesses: vi.fn(async () => {
              throw new Error("password=secret-value business-id=private");
            }),
          },
          close,
        })),
      }),
    );

    expect(result).toEqual({ exitCode: 1, stdout: "", stderr: "Service expiration dry-run read failed" });
    expect(close).toHaveBeenCalledOnce();
    expect(result.stderr).not.toContain("secret-value");
    expect(result.stderr).not.toContain("private");
  });
});
