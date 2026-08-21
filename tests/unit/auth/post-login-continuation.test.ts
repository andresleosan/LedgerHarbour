import { describe, expect, it } from "vitest";

import PostLoginContinuationPage from "../../../src/app/(auth)/auth/continue/page";

const { buildPostLoginRedirect } = PostLoginContinuationPage;

describe("post-login continuation redirect", () => {
  it("preserves locale for an administrator destination", () => {
    expect(buildPostLoginRedirect("/admin", { locale: "es" })).toBe("/admin?locale=es");
  });

  it("falls back to English for an invalid onboarding locale", () => {
    expect(buildPostLoginRedirect("/onboarding", { locale: "fr" })).toBe("/onboarding?locale=en");
  });

  it("preserves locale when redirecting an unauthenticated user to login", () => {
    expect(buildPostLoginRedirect("/login", { locale: "es" })).toBe("/login?locale=es");
  });

  it("preserves functional query parameters", () => {
    expect(buildPostLoginRedirect("/admin", {
      locale: "es",
      next: "/onboarding",
      status: "pending",
    })).toBe("/admin?locale=es&next=%2Fonboarding&status=pending");
  });
});
