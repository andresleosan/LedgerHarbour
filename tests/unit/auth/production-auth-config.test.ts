import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { createAuthProvider } from "../../../src/modules/auth/dev-auth-provider";

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
});
