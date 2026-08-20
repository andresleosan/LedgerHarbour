import { afterEach, describe, expect, it, vi } from "vitest";

import { formatPlatformDate } from "../../../src/ui/platform/platform-date";

const TIMEZONE_BOUNDARY = "2026-08-16T01:53:13.139Z";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("platform date formatting", () => {
  it("renders the UTC day in English when the process timezone is America/Bogota", () => {
    vi.stubEnv("TZ", "America/Bogota");

    expect(formatPlatformDate(TIMEZONE_BOUNDARY, "en")).toBe("16 Aug 2026");
  });

  it("renders the UTC day in Spanish when the process timezone is America/Bogota", () => {
    vi.stubEnv("TZ", "America/Bogota");

    expect(formatPlatformDate(TIMEZONE_BOUNDARY, "es")).toBe("16 ago 2026");
  });

  it("renders a missing date as an em dash", () => {
    expect(formatPlatformDate(null, "en")).toBe("\u2014");
  });

  it("does not hide invalid platform dates", () => {
    expect(() => formatPlatformDate("not-a-date", "en")).toThrow(RangeError);
  });

  it("does not hide an empty platform date", () => {
    expect(() => formatPlatformDate("", "en")).toThrow(RangeError);
  });
});
