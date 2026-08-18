import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { createAuthProvider } from "../../../src/modules/auth/dev-auth-provider";
import { navigateAfterSuccessfulLogin } from "../../../src/ui/auth/post-login-navigation";

const source = (relativePath: string) =>
  readFileSync(new URL(`../../../src/${relativePath}`, import.meta.url), "utf8");

describe("production authentication boundary", () => {
  it("rejects the development provider outside the explicit test harness", () => {
    vi.stubEnv("AUTH_MODE", "development");
    vi.stubEnv("NODE_ENV", "development");

    try {
      expect(createAuthProvider()).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects the development provider when production wins over the test marker", () => {
    vi.stubEnv("AUTH_MODE", "development");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LEDGERHARBOUR_TEST_MODE", "true");

    try {
      expect(createAuthProvider()).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps production auth pages on Firebase instead of development mode", () => {
    expect(source("app/(auth)/login/page.tsx")).toContain("FirebaseAuthProvider");
    expect(source("app/(auth)/register/page.tsx")).toContain("FirebaseAuthProvider");
    expect(source("app/(auth)/login/page.tsx")).not.toContain('authMode={"development"}');
    expect(source("app/(auth)/register/page.tsx")).not.toContain('authMode={"development"}');
  });

  it("removes demo CTA, accounts, and simulated-provider copy", () => {
    expect(source("app/page.tsx")).not.toContain("openDemo");
    expect(source("i18n/messages/en.json")).not.toContain("Open demo");
    expect(source("i18n/messages/es.json")).not.toContain("Abrir demo");
    expect(source("ui/auth/AuthForm.tsx")).not.toContain("demoAccount");
    expect(source("ui/auth/AuthForm.tsx")).not.toContain("googleSimulation");
    expect(source("i18n/messages/en.json")).not.toContain("Development simulation");
    expect(source("i18n/messages/es.json")).not.toContain("Simulación de desarrollo");
  });

  it("wires both production login flows through the executable navigation policy", () => {
    const authForm = source("ui/auth/AuthForm.tsx");

    expect(authForm).toMatch(/navigateAfterSuccessfulLogin\(\{\s*flow: "googleRedirectCompletion"/);
    expect(authForm).toMatch(/navigateAfterSuccessfulLogin\(\{\s*flow: "email"/);
  });

  it("navigates Google redirect completion through the server continuation boundary", () => {
    const replace = vi.fn();

    navigateAfterSuccessfulLogin({
      flow: "googleRedirectCompletion",
      mode: "login",
      authMode: "firebase",
      isDeterministicFirebaseTest: false,
    }, replace);

    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/auth/continue");
  });

  it("navigates email login through the server continuation boundary", () => {
    const replace = vi.fn();

    navigateAfterSuccessfulLogin({
      flow: "email",
      mode: "login",
      authMode: "firebase",
      isDeterministicFirebaseTest: false,
    }, replace);

    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/auth/continue");
  });

  it.each(["googleRedirectCompletion", "email"] as const)(
    "keeps deterministic %s login from navigating automatically",
    (flow) => {
      const replace = vi.fn();

      navigateAfterSuccessfulLogin({
        flow,
        mode: "login",
        authMode: "firebase",
        isDeterministicFirebaseTest: true,
      }, replace);

      expect(replace).not.toHaveBeenCalled();
    },
  );

  it("keeps Firebase registration from navigating automatically", () => {
    const replace = vi.fn();

    navigateAfterSuccessfulLogin({
      flow: "email",
      mode: "register",
      authMode: "firebase",
      isDeterministicFirebaseTest: false,
    }, replace);

    expect(replace).not.toHaveBeenCalled();
  });

  it("provides the authenticated server continuation route", () => {
    const continuationUrl = new URL("../../../src/app/(auth)/auth/continue/page.tsx", import.meta.url);

    expect(existsSync(continuationUrl)).toBe(true);
    if (!existsSync(continuationUrl)) return;

    const continuation = readFileSync(continuationUrl, "utf8");
    expect(continuation).toContain("getCurrentIdentity");
    expect(continuation).toContain("resolvePostLoginDestination");
    expect(continuation).toContain('redirect("/login")');
  });
});
