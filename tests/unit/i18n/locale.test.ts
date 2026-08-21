import { describe, expect, it } from "vitest";

import { resolveLocale, withLocale } from "../../../src/i18n/locale";

describe("locale URL contract", () => {
  it.each([["en", "en"], ["es", "es"], [null, "en"], [undefined, "en"], ["fr", "en"]] as const)(
    "resolves %s to %s",
    (value, expected) => expect(resolveLocale(value)).toBe(expected),
  );

  it("replaces locale without dropping functional parameters", () => {
    expect(withLocale("/login", "locale=en&next=%2Fonboarding&status=pending", "es"))
      .toBe("/login?locale=es&next=%2Fonboarding&status=pending");
  });

  it("adds locale to a destination that has no query", () => {
    expect(withLocale("/auth/continue", "", "es")).toBe("/auth/continue?locale=es");
  });
});
