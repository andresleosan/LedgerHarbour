import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  assertProductionConfiguration,
  ProductionConfigurationError,
} from "../../../src/modules/config/production-gate";
import { createPlaywrightServerEnv } from "../../../scripts/playwright-server";

function validProductionEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    AUTH_MODE: "firebase",
    OCR_PROVIDER: "google-document-ai",
    PERSISTENCE_MODE: "postgres",
    STORAGE_MODE: "r2",
    RATE_LIMIT_MODE: "upstash",
    DATABASE_URL: "postgresql://runtime.ledgerharbour.invalid/ledgerharbour",
    FIREBASE_PROJECT_ID: "ledgerharbour-prod",
    FIREBASE_CLIENT_EMAIL: "firebase-adminsdk@ledgerharbour-prod.iam.gserviceaccount.com",
    FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nunit-key-material\n-----END PRIVATE KEY-----\n",
    NEXT_PUBLIC_FIREBASE_API_KEY: "web-api-key-7f3a8c2d",
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "ledgerharbour-prod.firebaseapp.com",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "ledgerharbour-prod",
    NEXT_PUBLIC_FIREBASE_APP_ID: "1:1234567890:web:abcdef123456",
    R2_ENDPOINT: "https://account-id.r2.cloudflarestorage.com",
    R2_BUCKET_NAME: "ledgerharbour-prod",
    R2_ACCESS_KEY_ID: "r2-access-7f3a8c2d",
    R2_SECRET_ACCESS_KEY: "r2-secret-7f3a8c2d",
    UPSTASH_REDIS_REST_URL: "https://redis-ledgerharbour.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "upstash-token-7f3a8c2d",
    GOOGLE_CLOUD_PROJECT_ID: "ledgerharbour-prod",
    GOOGLE_CLOUD_LOCATION: "us",
    GOOGLE_DOCUMENT_AI_PROCESSOR_ID: "processor-id",
    GOOGLE_SERVICE_ACCOUNT_JSON: '{"type":"service_account","project_id":"ledgerharbour-prod","client_email":"ocr@ledgerharbour-prod.iam.gserviceaccount.com","private_key":"-----BEGIN PRIVATE KEY-----\\nunit-key-material\\n-----END PRIVATE KEY-----\\n"}',
  };
}

describe("production configuration gate", () => {
  it("accepts the complete production contract", () => {
    expect(() => assertProductionConfiguration(validProductionEnvironment())).not.toThrow();
  });

  it("fails closed with a generic error when a required value is missing", () => {
    const environment = validProductionEnvironment();
    delete environment.FIREBASE_PRIVATE_KEY;

    expect(() => assertProductionConfiguration(environment)).toThrow(ProductionConfigurationError);
    expect(() => assertProductionConfiguration(environment)).toThrow("Production configuration is invalid.");
    expect(() => assertProductionConfiguration(environment)).not.toThrowError(/FIREBASE_PRIVATE_KEY|test-key/);
  });

  it.each([
    ["DATABASE_URL", "postgresql://replace-with-database-url/ledgerharbour"],
    ["R2_ENDPOINT", "https://<account-id>.r2.cloudflarestorage.com"],
    ["UPSTASH_REDIS_REST_URL", "https://replace-with-upstash-endpoint.upstash.io"],
    ["R2_ACCESS_KEY_ID", "replace-with-r2-access-key"],
    ["GOOGLE_DOCUMENT_AI_PROCESSOR_ID", "replace-with-invoice-parser-id"],
  ])("rejects placeholders in %s", (name, value) => {
    const environment = validProductionEnvironment();
    environment[name] = value;

    expect(() => assertProductionConfiguration(environment)).toThrow("Production configuration is invalid.");
    expect(() => assertProductionConfiguration(environment)).not.toThrowError(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("rejects malformed Google service account JSON without exposing it", () => {
    const environment = validProductionEnvironment();
    const malformed = "google-service-account-secret";
    environment.GOOGLE_SERVICE_ACCOUNT_JSON = malformed;

    expect(() => assertProductionConfiguration(environment)).toThrow("Production configuration is invalid.");
    expect(() => assertProductionConfiguration(environment)).not.toThrowError(new RegExp(malformed));
  });

  it("rejects incomplete Google service account credentials", () => {
    const environment = validProductionEnvironment();
    environment.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ type: "service_account", project_id: "ledgerharbour-prod" });

    expect(() => assertProductionConfiguration(environment)).toThrow("Production configuration is invalid.");
  });

  it("rejects inconsistent Firebase and Google project configuration", () => {
    const environment = validProductionEnvironment();
    environment.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "other-project";

    expect(() => assertProductionConfiguration(environment)).toThrow("Production configuration is invalid.");
  });

  it.each([
    ["FIREBASE_PROJECT_ID", "example-project"],
    ["NEXT_PUBLIC_FIREBASE_API_KEY", "test-public-api-key"],
    ["R2_ACCESS_KEY_ID", "synthetic-r2-key"],
    ["UPSTASH_REDIS_REST_TOKEN", "fake-upstash-token"],
  ])("rejects obvious synthetic values in %s", (name, value) => {
    const environment = validProductionEnvironment();
    environment[name] = value;

    expect(() => assertProductionConfiguration(environment)).toThrow("Production configuration is invalid.");
  });

  it("requires the exact Cloudflare R2 endpoint host", () => {
    const environment = validProductionEnvironment();
    environment.R2_ENDPOINT = "https://account-id.r2.example.com";

    expect(() => assertProductionConfiguration(environment)).toThrow("Production configuration is invalid.");
  });

  it.each([
    ["R2_ENDPOINT", "https://account-id.r2.cloudflarestorage.com/path"],
    ["R2_ENDPOINT", "https://account-id.r2.cloudflarestorage.com?token=value"],
    ["R2_ENDPOINT", "https://account-id.r2.cloudflarestorage.com#fragment"],
    ["R2_ENDPOINT", "https://user:pass@account-id.r2.cloudflarestorage.com"],
    ["R2_ENDPOINT", "https://account-id.r2.cloudflarestorage.com:443"],
    ["UPSTASH_REDIS_REST_URL", "https://redis-ledgerharbour.upstash.io/path"],
    ["UPSTASH_REDIS_REST_URL", "https://redis-ledgerharbour.upstash.io?token=value"],
    ["UPSTASH_REDIS_REST_URL", "https://redis-ledgerharbour.upstash.io#fragment"],
    ["UPSTASH_REDIS_REST_URL", "https://user:pass@redis-ledgerharbour.upstash.io"],
    ["UPSTASH_REDIS_REST_URL", "https://redis-ledgerharbour.upstash.io:443"],
    ["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "ledgerharbour-prod.firebaseapp.com/path"],
    ["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "ledgerharbour-prod.firebaseapp.com?query=value"],
    ["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "user@ledgerharbour-prod.firebaseapp.com"],
    ["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "ledgerharbour-prod.firebaseapp.com:443"],
    ["GOOGLE_CLOUD_LOCATION", "us/path"],
    ["GOOGLE_CLOUD_LOCATION", "https://documentai.googleapis.com"],
    ["GOOGLE_CLOUD_LOCATION", "us?query=value"],
  ])("rejects unsafe endpoint syntax in %s", (name, value) => {
    const environment = validProductionEnvironment();
    environment[name] = value;

    expect(() => assertProductionConfiguration(environment)).toThrow("Production configuration is invalid.");
  });

  it.each([
    ["DATABASE_URL", "not-a-database-url"],
    ["R2_ENDPOINT", "http://account-id.r2.cloudflarestorage.com"],
    ["UPSTASH_REDIS_REST_URL", "not-a-redis-url"],
  ])("rejects invalid URL in %s", (name, value) => {
    const environment = validProductionEnvironment();
    environment[name] = value;

    expect(() => assertProductionConfiguration(environment)).toThrow("Production configuration is invalid.");
  });

  it.each([
    ["AUTH_MODE", "development"],
    ["OCR_PROVIDER", "fake"],
    ["PERSISTENCE_MODE", "memory"],
    ["STORAGE_MODE", "local"],
    ["RATE_LIMIT_MODE", "memory"],
  ])("rejects %s=%s in production", (name, value) => {
    const environment = validProductionEnvironment();
    environment[name] = value;

    expect(() => assertProductionConfiguration(environment)).toThrow("Production configuration is invalid.");
  });

  it("keeps the browser harness on explicit non-paid test providers", () => {
    const source = readFileSync(new URL("../../../playwright.config.ts", import.meta.url), "utf8");
    const serverSource = readFileSync(new URL("../../../scripts/playwright-server.ts", import.meta.url), "utf8");

    expect(serverSource).toContain('AUTH_MODE: "firebase"');
    expect(serverSource).toContain('OCR_PROVIDER: "fake"');
    expect(serverSource).toContain('PERSISTENCE_MODE: "memory"');
    expect(serverSource).toContain('STORAGE_MODE: "local"');
    expect(serverSource).toContain('RATE_LIMIT_MODE: "memory"');
    expect(serverSource).toContain('LEDGERHARBOUR_PLAYWRIGHT_HARNESS: "true"');
    expect(serverSource).not.toContain("...process.env");
    expect(source).not.toContain("GOOGLE_SERVICE_ACCOUNT_JSON");
    expect(source).toContain("scripts/playwright-server.ts");
    expect(source).not.toContain("env: createPlaywright");
  });

  it("passes only the test whitelist to the web server", () => {
    const effective = createPlaywrightServerEnv({
      NODE_ENV: "test",
      PATH: "test-path",
      DATABASE_URL: "postgresql://secret.example/database",
      GOOGLE_SERVICE_ACCOUNT_JSON: "secret-json",
      R2_SECRET_ACCESS_KEY: "secret-r2",
      UPSTASH_REDIS_REST_TOKEN: "secret-upstash",
      FIREBASE_PRIVATE_KEY: "secret-firebase",
    });

    expect(effective).toMatchObject({ PATH: "test-path", NODE_ENV: "test", AUTH_MODE: "firebase", OCR_PROVIDER: "fake" });
    expect(effective).not.toHaveProperty("DATABASE_URL");
    expect(effective).not.toHaveProperty("GOOGLE_SERVICE_ACCOUNT_JSON");
    expect(effective).not.toHaveProperty("R2_SECRET_ACCESS_KEY");
    expect(effective).not.toHaveProperty("UPSTASH_REDIS_REST_TOKEN");
    expect(effective).not.toHaveProperty("FIREBASE_PRIVATE_KEY");
  });

  it.skipIf(!existsSync(new URL("../../../.github/workflows/ci.yml", import.meta.url)))
  ("keeps CI on explicit test providers without development auth or secrets when a workflow exists", () => {
    const source = readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");

    expect(source).toContain("AUTH_MODE: firebase");
    expect(source).toContain("OCR_PROVIDER: fake");
    expect(source).toContain("PERSISTENCE_MODE: memory");
    expect(source).toContain("STORAGE_MODE: local");
    expect(source).toContain("RATE_LIMIT_MODE: memory");
    expect(source).not.toContain("AUTH_MODE: development");
    expect(source).not.toContain("DEV_SESSION_SECRET");
    expect(source).not.toContain("DATABASE_URL:");
    expect(source).not.toContain("GOOGLE_SERVICE_ACCOUNT_JSON:");
    expect(source).not.toContain("FIREBASE_PRIVATE_KEY:");
    expect(source).not.toContain("R2_SECRET_ACCESS_KEY:");
    expect(source).not.toContain("UPSTASH_REDIS_REST_TOKEN:");
  });

  it("keeps Vitest on Firebase test auth instead of development sessions", () => {
    const source = readFileSync(new URL("../../../tests/setup.ts", import.meta.url), "utf8");

    expect(source).toContain('AUTH_MODE ??= "firebase"');
    expect(source).not.toContain("DEV_SESSION_SECRET");
    expect(source).not.toContain('AUTH_MODE ??= "development"');
  });
});
