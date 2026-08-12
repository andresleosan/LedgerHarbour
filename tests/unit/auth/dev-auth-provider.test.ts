import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const { cookieState, cookieStore, cookiesMock } = vi.hoisted(() => {
  const state = new Map<string, string>();
  const store = {
    get: vi.fn((name: string) => {
      const value = state.get(name);
      return value === undefined ? undefined : { name, value };
    }),
    set: vi.fn((name: string, value: string) => {
      state.set(name, value);
    }),
    delete: vi.fn((name: string) => {
      state.delete(name);
    }),
  };
  return { cookieState: state, cookieStore: store, cookiesMock: vi.fn(() => store) };
});

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

import {
  AUTH_ERROR_CODES,
  AuthError,
  toAuthError,
} from "../../../src/modules/auth/auth-errors";
import {
  createAuthProviderFromActions,
  type AuthIdentity,
  type AuthProviderActions,
  type AuthProvider,
} from "../../../src/modules/auth/auth-provider";
import {
  createAuthProvider,
  DevAuthProvider,
} from "../../../src/modules/auth/dev-auth-provider";
import {
  DEV_SESSION_COOKIE,
  DEV_SESSION_MAX_AGE,
  clearCurrentIdentity,
  setCurrentIdentity,
} from "../../../src/modules/auth/session";
import {
  defaultLocale,
  enMessages,
  esMessages,
  supportedLocales,
  type SupportedLocale,
} from "../../../src/i18n/config";

const identityFor = (identity: AuthIdentity) => ({
  providerUserId: identity.providerUserId,
  email: identity.email,
  displayName: identity.displayName,
  emailVerified: identity.emailVerified,
});

const flattenKeys = (value: Record<string, unknown>, prefix = ""): string[] =>
  Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === "object" && child !== null
      ? flattenKeys(child as Record<string, unknown>, path)
      : [path];
  });

describe("development authentication provider", () => {
  beforeEach(async () => {
    process.env.AUTH_MODE = "development";
    process.env.DEV_SESSION_SECRET = "test-development-session-secret";
    cookieState.clear();
    vi.clearAllMocks();
    await new DevAuthProvider().signOut();
    vi.clearAllMocks();
  });

  it("signs in with a trimmed email and returns only the public identity fields", async () => {
    const provider = new DevAuthProvider();

    await expect(provider.signInWithEmail({ email: "  ADMIN@ADMIN.COM  " })).resolves.toSatisfy(
      (identity: AuthIdentity) => {
        expect(identityFor(identity)).toEqual({
          providerUserId: expect.stringMatching(/^dev-[a-f0-9]{8}$/),
          email: "admin@admin.com",
          displayName: "Demo Admin",
          emailVerified: true,
        });
        return true;
      },
    );
  });

  it.each(["", "   ", "not-an-email", "missing@domain", "bad address@example.com"])(
    "rejects invalid email %j without creating a session",
    async (email) => {
      const provider = new DevAuthProvider();

      await expect(provider.signInWithEmail({ email })).rejects.toMatchObject({
        code: AUTH_ERROR_CODES.INVALID_EMAIL,
        message: "Enter a valid email address.",
      });
      await expect(provider.getCurrentIdentity()).resolves.toBeNull();
    },
  );

  it("derives the same demo identity for the same validated email", async () => {
    const first = new DevAuthProvider();
    const second = new DevAuthProvider();

    const firstIdentity = await first.signInWithEmail({ email: "member@example.com" });
    await second.signOut();
    const secondIdentity = await second.signInWithEmail({ email: " member@example.com " });

    expect(secondIdentity).toEqual(firstIdentity);
  });

  it("simulates Google sign-in with a verified development identity", async () => {
    const provider = new DevAuthProvider();

    await expect(provider.signInWithGoogle()).resolves.toEqual({
      providerUserId: "dev-google-user",
      email: "google-user@development.ledgerharbour.local",
      displayName: "Development Google User",
      emailVerified: true,
    });
  });

  it("supports sign-out and reading the current identity", async () => {
    const provider = new DevAuthProvider();
    const identity = await provider.signInWithEmail({ email: "member@example.com" });

    await expect(provider.getCurrentIdentity()).resolves.toEqual(identity);
    await expect(provider.signOut()).resolves.toBeUndefined();
    await expect(provider.getCurrentIdentity()).resolves.toBeNull();
  });

  it("persists identity across separate provider calls with a protected short-lived cookie", async () => {
    const firstProvider = new DevAuthProvider();
    const secondProvider = new DevAuthProvider();

    const identity = await firstProvider.signInWithEmail({ email: "member@example.com" });

    await expect(secondProvider.getCurrentIdentity()).resolves.toEqual(identity);
    expect(cookieStore.set).toHaveBeenCalledWith(
      DEV_SESSION_COOKIE,
      expect.stringMatching(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: DEV_SESSION_MAX_AGE,
      }),
    );
    expect(cookieState.get(DEV_SESSION_COOKIE)).not.toContain("member@example.com");
  });

  it("clears the request session cookie on sign-out", async () => {
    const provider = new DevAuthProvider();
    await provider.signInWithEmail({ email: "member@example.com" });

    await provider.signOut();

    expect(cookieStore.delete).toHaveBeenCalledWith(DEV_SESSION_COOKIE);
    await expect(new DevAuthProvider().getCurrentIdentity()).resolves.toBeNull();
  });

  it("rejects malformed and expired session cookies", async () => {
    const provider = new DevAuthProvider();
    cookieState.set(DEV_SESSION_COOKIE, "not-a-development-session");

    await expect(provider.getCurrentIdentity()).resolves.toBeNull();

    await provider.signInWithEmail({ email: "member@example.com" });
    const cookieValue = cookieState.get(DEV_SESSION_COOKIE);
    const [payload] = (cookieValue ?? "").split(".");
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      expiresAt: number;
    };
    session.expiresAt = Date.now() - 1;
    const expiredPayload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
    const expiredSignature = createHmac("sha256", process.env.DEV_SESSION_SECRET ?? "")
      .update(expiredPayload)
      .digest("base64url");
    cookieState.set(DEV_SESSION_COOKIE, `${expiredPayload}.${expiredSignature}`);

    await expect(new DevAuthProvider().getCurrentIdentity()).resolves.toBeNull();
  });

  it("rejects a valid-looking session when the signing secret is missing", async () => {
    const provider = new DevAuthProvider();
    await provider.signInWithEmail({ email: "member@example.com" });
    delete process.env.DEV_SESSION_SECRET;

    await expect(new DevAuthProvider().getCurrentIdentity()).resolves.toBeNull();
  });

  it("rejects a session after the signing secret changes", async () => {
    const provider = new DevAuthProvider();
    await provider.signInWithEmail({ email: "member@example.com" });
    process.env.DEV_SESSION_SECRET = "different-development-session-secret";

    await expect(new DevAuthProvider().getCurrentIdentity()).resolves.toBeNull();
  });

  it("rejects a payload changed without a matching signature", async () => {
    const provider = new DevAuthProvider();
    await provider.signInWithEmail({ email: "member@example.com" });
    const cookieValue = cookieState.get(DEV_SESSION_COOKIE) as string;
    const [payload, signature] = cookieValue.split(".");
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { identity: AuthIdentity };
    session.identity = { ...session.identity, displayName: "Tampered identity" };
    const tamperedPayload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
    cookieState.set(DEV_SESSION_COOKIE, `${tamperedPayload}.${signature}`);

    await expect(new DevAuthProvider().getCurrentIdentity()).resolves.toBeNull();
  });

  it("does not reuse an identity when no request cookie store is available", async () => {
    const provider = new DevAuthProvider();
    await provider.signInWithEmail({ email: "member@example.com" });
    cookiesMock.mockImplementationOnce(() => {
      throw new Error("request store unavailable");
    });

    await expect(provider.getCurrentIdentity()).resolves.toBeNull();
  });

  it("returns no identity and does not touch cookies when development mode is disabled", async () => {
    const provider = new DevAuthProvider();
    const identity = await provider.signInWithEmail({ email: "member@example.com" });
    vi.clearAllMocks();
    process.env.AUTH_MODE = "production";

    await setCurrentIdentity(identity);
    await expect(provider.getCurrentIdentity()).resolves.toBeNull();
    await clearCurrentIdentity();

    expect(cookieStore.get).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalled();
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("normalizes unknown provider failures to a generic public error", () => {
    const cause = new Error("private provider credentials and endpoint details");
    const error = toAuthError(cause);

    expect(error).toBeInstanceOf(AuthError);
    expect(error.code).toBe(AUTH_ERROR_CODES.PROVIDER_FAILURE);
    expect(error.message).toBe("Authentication is temporarily unavailable.");
    expect(error.message).not.toContain("credentials");
    expect(JSON.stringify(error)).not.toContain("endpoint");
  });

  it("preserves known public error codes after a server action boundary", () => {
    expect(toAuthError(new Error("Enter a valid email address.")).code).toBe(
      AUTH_ERROR_CODES.INVALID_EMAIL,
    );
    expect(toAuthError(new Error("We could not find an active identity.")).code).toBe(
      AUTH_ERROR_CODES.MISSING_IDENTITY,
    );
  });

  it("keeps a missing identity generic", () => {
    const error = new AuthError(AUTH_ERROR_CODES.MISSING_IDENTITY);

    expect(error.message).toBe("We could not find an active identity.");
    expect(error.message).not.toContain("email");
  });

  it("requires development mode and never silently enables the provider", async () => {
    process.env.AUTH_MODE = "production";

    expect(() => new DevAuthProvider()).toThrowError(
      expect.objectContaining({
        code: AUTH_ERROR_CODES.DEVELOPMENT_MODE_REQUIRED,
      }),
    );
  });

  it("keeps the development guard intrinsic when a consumer passes an argument", () => {
    process.env.AUTH_MODE = "production";

    expect(() => Reflect.construct(DevAuthProvider, ["development"])).toThrowError(
      expect.objectContaining({
        code: AUTH_ERROR_CODES.DEVELOPMENT_MODE_REQUIRED,
      }),
    );
  });

  it("fails closed when AUTH_MODE is absent", () => {
    delete process.env.AUTH_MODE;

    expect(() => new DevAuthProvider()).toThrowError(
      expect.objectContaining({
        code: AUTH_ERROR_CODES.DEVELOPMENT_MODE_REQUIRED,
      }),
    );
    expect(createAuthProvider()).toBeNull();
  });

  it("creates an AuthProvider only when the environment and request agree", () => {
    process.env.AUTH_MODE = "development";

    const provider: AuthProvider | null = createAuthProvider();

    expect(provider).not.toBeNull();
    expect(provider).toMatchObject({
      signInWithEmail: expect.any(Function),
      signInWithGoogle: expect.any(Function),
      signOut: expect.any(Function),
      getCurrentIdentity: expect.any(Function),
    });
  });

  it("adapts injected provider actions to the AuthProvider boundary", async () => {
    const identity: AuthIdentity = {
      providerUserId: "injected-user",
      email: "injected@example.com",
      displayName: "Injected User",
      emailVerified: true,
    };
    const actions: AuthProviderActions = {
      signInWithEmail: async () => identity,
      signInWithGoogle: async () => identity,
      signOut: async () => undefined,
      getCurrentIdentity: async () => identity,
    };

    const provider = createAuthProviderFromActions(actions);

    await expect(provider.signInWithEmail({ email: identity.email })).resolves.toEqual(identity);
    await expect(provider.signInWithGoogle()).resolves.toEqual(identity);
    await expect(provider.getCurrentIdentity()).resolves.toEqual(identity);
    await expect(provider.signOut()).resolves.toBeUndefined();
  });

  it.each([
    ["missing@development.ledgerharbour.local", AUTH_ERROR_CODES.MISSING_IDENTITY],
    ["failure@development.ledgerharbour.local", AUTH_ERROR_CODES.PROVIDER_FAILURE],
  ])("keeps the development %s state generic", async (email, code) => {
    const provider = new DevAuthProvider();

    await expect(provider.signInWithEmail({ email })).rejects.toMatchObject({
      code,
      message: expect.not.stringContaining(email),
    });
  });

  it("exports only English and Spanish with English as the default", () => {
    const locales: readonly SupportedLocale[] = supportedLocales;

    expect(locales).toEqual(["en", "es"]);
    expect(defaultLocale).toBe("en");
  });

  it("keeps every English auth message key present in Spanish", () => {
    expect(flattenKeys(enMessages)).toEqual(flattenKeys(esMessages));
  });
});
