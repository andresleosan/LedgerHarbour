import { describe, expect, it, vi } from "vitest";

import { navigateAfterSuccessfulLogin } from "../../../src/ui/auth/post-login-navigation";

describe("post-login navigation", () => {
  it("keeps locale on successful Firebase login", () => {
    const replace = vi.fn();

    navigateAfterSuccessfulLogin({
      flow: "email",
      mode: "login",
      authMode: "firebase",
      isDeterministicFirebaseTest: false,
      locale: "es",
      currentSearchParams: "",
    }, replace);

    expect(replace).toHaveBeenCalledWith("/auth/continue?locale=es");
  });

  it("preserves functional query parameters on successful Firebase login", () => {
    const replace = vi.fn();

    navigateAfterSuccessfulLogin({
      flow: "email",
      mode: "login",
      authMode: "firebase",
      isDeterministicFirebaseTest: false,
      locale: "es",
      currentSearchParams: new URLSearchParams("next=%2Fonboarding%3Ftab%3Dopen&status=pending&locale=en"),
    }, replace);

    expect(replace).toHaveBeenCalledWith(
      "/auth/continue?next=%2Fonboarding%3Ftab%3Dopen&status=pending&locale=es",
    );
  });

  it("preserves functional query parameters on Google redirect completion", () => {
    const replace = vi.fn();

    navigateAfterSuccessfulLogin({
      flow: "googleRedirectCompletion",
      mode: "login",
      authMode: "firebase",
      isDeterministicFirebaseTest: false,
      locale: "es",
      currentSearchParams: "next=%2Fadmin%3Ftab%3Dusers&locale=en",
    }, replace);

    expect(replace).toHaveBeenCalledWith("/auth/continue?next=%2Fadmin%3Ftab%3Dusers&locale=es");
  });

  it.each([
    ["registration", { flow: "email" as const, mode: "register" as const, authMode: "firebase" as const, isDeterministicFirebaseTest: false, currentSearchParams: "" }],
    ["development auth", { flow: "email" as const, mode: "login" as const, authMode: "development" as const, isDeterministicFirebaseTest: false, currentSearchParams: "" }],
    ["deterministic Firebase test", { flow: "email" as const, mode: "login" as const, authMode: "firebase" as const, isDeterministicFirebaseTest: true, currentSearchParams: "" }],
  ])("does not navigate automatically for %s", (_name, input) => {
    const replace = vi.fn();

    navigateAfterSuccessfulLogin({ ...input, locale: "es" }, replace);

    expect(replace).not.toHaveBeenCalled();
  });
});
