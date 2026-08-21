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
    }, replace);

    expect(replace).toHaveBeenCalledWith("/auth/continue?locale=es");
  });

  it.each([
    ["registration", { flow: "email" as const, mode: "register" as const, authMode: "firebase" as const, isDeterministicFirebaseTest: false }],
    ["development auth", { flow: "email" as const, mode: "login" as const, authMode: "development" as const, isDeterministicFirebaseTest: false }],
    ["deterministic Firebase test", { flow: "email" as const, mode: "login" as const, authMode: "firebase" as const, isDeterministicFirebaseTest: true }],
  ])("does not navigate automatically for %s", (_name, input) => {
    const replace = vi.fn();

    navigateAfterSuccessfulLogin({ ...input, locale: "es" }, replace);

    expect(replace).not.toHaveBeenCalled();
  });
});
